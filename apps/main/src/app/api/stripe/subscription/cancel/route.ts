import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { syncStripeSubscriptionsForMember } from "@/lib/sync-stripe-subscriptions-for-member";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

/**
 * Cancel NWC membership subscriptions for this customer. Default: end immediately (Stripe
 * `subscriptions.cancel`). Optional `atPeriodEnd: true` only schedules cancellation.
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

  let atPeriodEnd = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.atPeriodEnd === "boolean") atPeriodEnd = body.atPeriodEnd;
  } catch {
    // ignore
  }

  const memberId = session.user.id;
  const customerId = await resolveStripeCustomerIdForMember(memberId);
  if (!customerId) {
    return NextResponse.json({ error: "No billing customer on file." }, { status: 400 });
  }

  const dbRows = await prisma.subscription.findMany({
    where: { memberId, stripeSubscriptionId: { not: null } },
    select: { stripeSubscriptionId: true },
  });
  const dbStripeIds = new Set(
    dbRows.map((r) => r.stripeSubscriptionId).filter((id): id is string => Boolean(id))
  );

  const activeList = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 40,
  });

  const toCancel = activeList.data.filter((s) => {
    const mid = s.metadata?.memberId?.trim();
    const pid = s.metadata?.planId?.trim();
    const isNwcMeta =
      mid === memberId && (pid === "subscribe" || pid === "sponsor" || pid === "seller");
    const inDb = dbStripeIds.has(s.id);
    return isNwcMeta || inDb;
  });

  if (toCancel.length === 0) {
    const trialing = await stripe.subscriptions.list({
      customer: customerId,
      status: "trialing",
      limit: 40,
    });
    const trialCancel = trialing.data.filter((s) => {
      const mid = s.metadata?.memberId?.trim();
      const pid = s.metadata?.planId?.trim();
      return mid === memberId && (pid === "subscribe" || pid === "sponsor" || pid === "seller");
    });
    for (const s of trialCancel) {
      if (atPeriodEnd) {
        await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.cancel(s.id);
      }
    }
    await syncStripeSubscriptionsForMember(memberId, stripe);
    return NextResponse.json({ ok: true, canceled: trialCancel.length });
  }

  for (const s of toCancel) {
    if (atPeriodEnd) {
      await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
    } else {
      await stripe.subscriptions.cancel(s.id);
    }
  }

  await syncStripeSubscriptionsForMember(memberId, stripe);
  return NextResponse.json({ ok: true, canceled: toCancel.length });
}
