import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";
import { syncStripeSubscriptionsForMember } from "@/lib/sync-stripe-subscriptions-for-member";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

type BillingInterval = "monthly" | "yearly";

function priceIdForPlan(planId: string, interval: BillingInterval): string | null {
  const plans: Record<string, { priceId: string; priceIdYearly?: string }> = {
    subscribe: {
      priceId: process.env.STRIPE_PRICE_SUBSCRIBE ?? "",
      priceIdYearly: process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY ?? "",
    },
    sponsor: {
      priceId: process.env.STRIPE_PRICE_SPONSOR ?? "",
      priceIdYearly: process.env.STRIPE_PRICE_SPONSOR_YEARLY ?? "",
    },
    seller: {
      priceId: process.env.STRIPE_PRICE_SELLER ?? "",
      priceIdYearly: process.env.STRIPE_PRICE_SELLER_YEARLY ?? "",
    },
  };
  const p = plans[planId];
  if (!p?.priceId) return null;
  return interval === "yearly" && p.priceIdYearly ? p.priceIdYearly : p.priceId;
}

/**
 * Switch the member's NWC membership to a different plan on the **same** Stripe Subscription
 * when possible; cancel extra active NWC subs on the customer to avoid double billing.
 * Uses `proration_behavior: none` so the new price applies from the next invoice.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey?.startsWith("sk_") || stripeSecretKey.includes("...")) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }

  let planId: string;
  let interval: BillingInterval = "monthly";
  try {
    const body = await req.json();
    planId = typeof body.planId === "string" ? body.planId.trim() : "";
    if (body.interval === "yearly" || body.interval === "monthly") {
      interval = body.interval;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (planId !== "subscribe" && planId !== "sponsor" && planId !== "seller") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const newPriceId = priceIdForPlan(planId, interval);
  if (!newPriceId) {
    return NextResponse.json(
      { error: interval === "yearly" ? "Yearly price not configured" : "Monthly price not configured" },
      { status: 400 }
    );
  }

  const memberId = session.user.id;
  const customerId = await resolveStripeCustomerIdForMember(memberId);
  if (!customerId) {
    return NextResponse.json({ error: "No billing customer on file." }, { status: 400 });
  }

  const activeList = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 40,
  });

  const nwcSubs = activeList.data.filter((s) => {
    const mid = s.metadata?.memberId?.trim();
    const pid = s.metadata?.planId?.trim();
    return mid === memberId && (pid === "subscribe" || pid === "sponsor" || pid === "seller");
  });

  if (nwcSubs.length === 0) {
    return NextResponse.json(
      { error: "No active membership subscription found. Subscribe first, then you can change plans here." },
      { status: 400 }
    );
  }

  const dbRow = await prisma.subscription.findFirst({
    where: {
      memberId,
      status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
      stripeSubscriptionId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });

  let primary =
    (dbRow?.stripeSubscriptionId
      ? nwcSubs.find((s) => s.id === dbRow.stripeSubscriptionId)
      : null) ?? nwcSubs[0];

  for (const s of nwcSubs) {
    if (s.id !== primary.id) {
      await stripe.subscriptions.cancel(s.id);
    }
  }

  const fullSub = await stripe.subscriptions.retrieve(primary.id);
  const firstItem = fullSub.items.data[0];
  if (!firstItem?.id) {
    return NextResponse.json({ error: "Subscription has no line items." }, { status: 500 });
  }

  const mergedMetadata: Stripe.MetadataParam = {
    ...fullSub.metadata,
    memberId,
    planId,
  };

  await stripe.subscriptions.update(fullSub.id, {
    items: [{ id: firstItem.id, price: newPriceId }],
    proration_behavior: "none",
    metadata: mergedMetadata,
  });

  await syncStripeSubscriptionsForMember(memberId, stripe);

  return NextResponse.json({ ok: true });
}
