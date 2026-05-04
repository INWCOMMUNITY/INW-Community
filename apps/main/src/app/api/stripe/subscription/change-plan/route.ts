import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, type Plan } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";
import { syncStripeSubscriptionsForMember } from "@/lib/sync-stripe-subscriptions-for-member";
import { planFromStripePriceId } from "@/lib/stripe-price-to-plan";
import { nwcPlanRank } from "@/lib/nwc-plan-rank";
import {
  getStripeSubscriptionPlanPriceIds,
  resolveStripeSubscriptionPriceId,
} from "@/lib/stripe-subscription-plan-env";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

const PLAN_SWITCH_WINDOW_DAYS = 30;
const PLAN_SWITCH_MAX_PER_WINDOW = 2;

type BillingInterval = "monthly" | "yearly";

function priceIdForPlan(planId: string, interval: BillingInterval): string | null {
  const plans = getStripeSubscriptionPlanPriceIds();
  return resolveStripeSubscriptionPriceId(plans, planId, interval);
}

function isAdminBypass(req: NextRequest): boolean {
  const code = req.headers.get("x-admin-code");
  const expected = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
  return !!code && code === expected;
}

function resolveCurrentPlan(sub: Stripe.Subscription): Plan | null {
  const meta = sub.metadata?.planId?.trim();
  if (meta === "subscribe" || meta === "sponsor" || meta === "seller") {
    return meta as Plan;
  }
  const rawPrice = sub.items.data[0]?.price;
  const priceId = typeof rawPrice === "string" ? rawPrice : rawPrice?.id ?? null;
  return planFromStripePriceId(priceId);
}

async function releaseSubscriptionScheduleIfAny(subscriptionId: string): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const sid = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  if (sid) {
    await stripe.subscriptionSchedules.cancel(sid);
  }
}

/**
 * Downgrades keep the current price (and perks) until the current billing period ends;
 * the new price applies from the next cycle via a two-phase subscription schedule.
 * Upgrades / lateral interval changes apply immediately (after releasing any schedule).
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

  const targetPlan = planId as Plan;
  const newPriceId = priceIdForPlan(planId, interval);
  if (!newPriceId) {
    return NextResponse.json(
      { error: interval === "yearly" ? "Yearly price not configured" : "Monthly price not configured" },
      { status: 400 }
    );
  }

  const memberId = session.user.id;
  const adminBypass = isAdminBypass(req);

  if (!adminBypass) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PLAN_SWITCH_WINDOW_DAYS);
    const recentCount = await prisma.planSwitchLog.count({
      where: { memberId, createdAt: { gte: cutoff } },
    });
    if (recentCount >= PLAN_SWITCH_MAX_PER_WINDOW) {
      return NextResponse.json(
        {
          error: "Plan change limit reached. You can switch plans at most twice per 30 days. Contact support if you need an exception.",
          requiresAdminApproval: true,
        },
        { status: 403 }
      );
    }
  }

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

  const currentPriceObj = firstItem.price;
  const currentPriceId =
    typeof currentPriceObj === "string" ? currentPriceObj : currentPriceObj?.id ?? "";
  if (currentPriceId === newPriceId) {
    return NextResponse.json({ error: "Already on this plan and billing interval." }, { status: 400 });
  }

  const currentPlan = resolveCurrentPlan(fullSub);
  if (!currentPlan) {
    return NextResponse.json({ error: "Could not determine current plan. Contact support." }, { status: 400 });
  }

  const isDowngrade = nwcPlanRank(targetPlan) < nwcPlanRank(currentPlan);
  const periodEndUnix = fullSub.current_period_end;
  if (!periodEndUnix) {
    return NextResponse.json({ error: "Subscription has no billing period end." }, { status: 500 });
  }

  try {
    if (isDowngrade) {
      let scheduleId =
        typeof fullSub.schedule === "string" ? fullSub.schedule : fullSub.schedule?.id ?? null;
      if (!scheduleId) {
        const created = await stripe.subscriptionSchedules.create({
          from_subscription: fullSub.id,
        });
        scheduleId = created.id;
      }
      const sched = await stripe.subscriptionSchedules.retrieve(scheduleId);
      const phase0 = sched.phases[0];
      if (!phase0?.start_date) {
        return NextResponse.json({ error: "Could not read subscription schedule." }, { status: 500 });
      }

      await stripe.subscriptionSchedules.update(scheduleId, {
        phases: [
          {
            start_date: phase0.start_date,
            end_date: periodEndUnix,
            items: [{ price: currentPriceId, quantity: 1 }],
            proration_behavior: "none",
          },
          {
            items: [{ price: newPriceId, quantity: 1 }],
            proration_behavior: "none",
          },
        ],
      });

      await stripe.subscriptions.update(fullSub.id, {
        metadata: {
          ...fullSub.metadata,
          memberId,
          planId: currentPlan,
        },
      });
    } else {
      await releaseSubscriptionScheduleIfAny(fullSub.id);
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
    }

    await prisma.planSwitchLog.create({
      data: {
        memberId,
        fromPlan: currentPlan,
        toPlan: targetPlan,
      },
    });

    await syncStripeSubscriptionsForMember(memberId, stripe);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/stripe/subscription/change-plan]", e);
    const msg = e instanceof Error ? e.message : "Stripe error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
