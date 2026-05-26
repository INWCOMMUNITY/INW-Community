import Stripe from "stripe";
import { prisma } from "database";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { syncStripeSubscriptionsForMember } from "@/lib/sync-stripe-subscriptions-for-member";
import { prismaWhereMemberSponsorOrSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { STRIPE_NOT_CONFIGURED_MESSAGE, resolveStripeSecretKey } from "@/lib/stripe-secret-key";

const BUSINESS_PLANS = new Set(["sponsor", "seller"]);

export type PauseMemberSubscriptionRetainProfileResult = {
  businessesGranted: number;
  subscriptionsCanceled: number;
  plansCanceled: string[];
};

function isNwcSubscriptionForMember(sub: Stripe.Subscription, memberId: string, dbStripeIds: Set<string>): boolean {
  const mid = sub.metadata?.memberId?.trim();
  const pid = sub.metadata?.planId?.trim();
  const isNwcMeta =
    mid === memberId && (pid === "subscribe" || pid === "sponsor" || pid === "seller");
  return isNwcMeta || dbStripeIds.has(sub.id);
}

function planIdFromSubscription(sub: Stripe.Subscription): string | null {
  const pid = sub.metadata?.planId?.trim();
  if (pid === "subscribe" || pid === "sponsor" || pid === "seller") return pid;
  return null;
}

function shouldCancelForPause(
  sub: Stripe.Subscription,
  memberId: string,
  dbStripeIds: Set<string>,
  dbPlanByStripeId: Map<string, string>
): boolean {
  if (!isNwcSubscriptionForMember(sub, memberId, dbStripeIds)) return false;
  const pid = planIdFromSubscription(sub) ?? dbPlanByStripeId.get(sub.id) ?? null;
  return pid != null && BUSINESS_PLANS.has(pid);
}

/**
 * Admin pause: grant `adminGrantedAt` on all member businesses first, then immediately cancel
 * sponsor/seller Stripe subscriptions so webhook cleanup keeps directory / Business Hub access.
 */
export async function pauseMemberSubscriptionRetainProfile(
  memberId: string,
  stripe: Stripe
): Promise<PauseMemberSubscriptionRetainProfileResult> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true },
  });
  if (!member) {
    throw new PauseMemberSubscriptionError("Member not found", 404);
  }

  const businessCount = await prisma.business.count({ where: { memberId } });
  if (businessCount === 0) {
    throw new PauseMemberSubscriptionError(
      "Member has no business profile to retain. Add a business first.",
      400
    );
  }

  const grantResult = await prisma.business.updateMany({
    where: { memberId, adminGrantedAt: null },
    data: { adminGrantedAt: new Date() },
  });

  const dbRows = await prisma.subscription.findMany({
    where: { memberId, stripeSubscriptionId: { not: null } },
    select: { stripeSubscriptionId: true, plan: true },
  });
  const dbStripeIds = new Set(
    dbRows.map((r) => r.stripeSubscriptionId).filter((id): id is string => Boolean(id))
  );
  const dbPlanByStripeId = new Map<string, string>();
  for (const r of dbRows) {
    if (r.stripeSubscriptionId) dbPlanByStripeId.set(r.stripeSubscriptionId, r.plan);
  }

  const customerId = await resolveStripeCustomerIdForMember(memberId);
  const plansCanceled: string[] = [];
  let subscriptionsCanceled = 0;

  if (customerId) {
    const statuses: Stripe.SubscriptionListParams["status"][] = ["active", "trialing", "past_due"];
    const toCancel: Stripe.Subscription[] = [];

    for (const status of statuses) {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status,
        limit: 40,
      });
      for (const sub of list.data) {
        if (shouldCancelForPause(sub, memberId, dbStripeIds, dbPlanByStripeId)) {
          toCancel.push(sub);
        }
      }
    }

    const seen = new Set<string>();
    for (const sub of toCancel) {
      if (seen.has(sub.id)) continue;
      seen.add(sub.id);
      await stripe.subscriptions.cancel(sub.id);
      subscriptionsCanceled += 1;
      const pid = planIdFromSubscription(sub);
      if (pid) plansCanceled.push(pid);
    }
  }

  await syncStripeSubscriptionsForMember(memberId, stripe);

  const stillActiveBusinessSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSponsorOrSellerPlanAccess(memberId),
    select: { id: true, plan: true },
  });

  if (subscriptionsCanceled === 0 && stillActiveBusinessSub) {
    throw new PauseMemberSubscriptionError(
      "Could not cancel an active Business or Seller subscription in Stripe. Check the member billing customer.",
      400
    );
  }

  if (subscriptionsCanceled === 0) {
    const hadGrantable = grantResult.count > 0;
    const anyGranted = await prisma.business.findFirst({
      where: { memberId, adminGrantedAt: { not: null } },
      select: { id: true },
    });
    if (!anyGranted && !hadGrantable) {
      throw new PauseMemberSubscriptionError("Member has no business profile to retain.", 400);
    }
  }

  return {
    businessesGranted: grantResult.count,
    subscriptionsCanceled,
    plansCanceled: [...new Set(plansCanceled)],
  };
}

export class PauseMemberSubscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PauseMemberSubscriptionError";
  }
}

export function assertStripeConfigured(): void {
  if (!resolveStripeSecretKey()) {
    throw new PauseMemberSubscriptionError(STRIPE_NOT_CONFIGURED_MESSAGE, 503);
  }
}
