import Stripe from "stripe";
import { prisma } from "database";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { syncStripeSubscriptionsForMember } from "@/lib/sync-stripe-subscriptions-for-member";
import { resolveStripeSecretKey } from "@/lib/stripe-secret-key";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

const BILLABLE_STRIPE_STATUSES: Stripe.SubscriptionListParams["status"][] = [
  "active",
  "trialing",
  "past_due",
];

const STRIPE_API_VERSION = "2024-11-20.acacia" as "2023-10-16";

export type CancelMemberActiveSubscriptionsResult = {
  canceled: number;
  billingCleanupPending: boolean;
  configured: boolean;
  noCustomer: boolean;
  ok: boolean;
};

export async function memberHasBillableLocalSubscription(memberId: string): Promise<boolean> {
  const row = await prisma.subscription.findFirst({
    where: {
      memberId,
      status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
    },
    select: { id: true },
  });
  return row != null;
}

function isNwcSubscription(
  sub: Stripe.Subscription,
  memberId: string,
  dbStripeIds: Set<string>
): boolean {
  const mid = sub.metadata?.memberId?.trim();
  const pid = sub.metadata?.planId?.trim();
  const isNwcMeta =
    mid === memberId && (pid === "subscribe" || pid === "sponsor" || pid === "seller");
  return isNwcMeta || dbStripeIds.has(sub.id);
}

function createStripeClient(secret: string): Stripe {
  return new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
}

/**
 * Cancel NWC Stripe subscriptions that can still bill (active / trialing / past_due).
 * Never writes local Subscription.status without a successful Stripe call + sync.
 */
export async function cancelMemberActiveSubscriptions(
  memberId: string,
  options?: { atPeriodEnd?: boolean; stripe?: Stripe }
): Promise<CancelMemberActiveSubscriptionsResult> {
  const localBillable = await memberHasBillableLocalSubscription(memberId);
  const secret = resolveStripeSecretKey();
  if (!options?.stripe && !secret) {
    return {
      canceled: 0,
      billingCleanupPending: localBillable,
      configured: false,
      noCustomer: false,
      ok: false,
    };
  }

  const stripe = options?.stripe ?? createStripeClient(secret as string);
  const customerId = await resolveStripeCustomerIdForMember(memberId);
  if (!customerId) {
    return {
      canceled: 0,
      billingCleanupPending: localBillable,
      configured: true,
      noCustomer: true,
      ok: true,
    };
  }

  const dbRows = await prisma.subscription.findMany({
    where: { memberId, stripeSubscriptionId: { not: null } },
    select: { stripeSubscriptionId: true },
  });
  const dbStripeIds = new Set(
    dbRows.map((r) => r.stripeSubscriptionId).filter((id): id is string => Boolean(id))
  );

  const toCancel: Stripe.Subscription[] = [];
  const seen = new Set<string>();
  try {
    for (const status of BILLABLE_STRIPE_STATUSES) {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status,
        limit: 40,
      });
      for (const sub of list.data) {
        if (seen.has(sub.id)) continue;
        if (!isNwcSubscription(sub, memberId, dbStripeIds)) continue;
        seen.add(sub.id);
        toCancel.push(sub);
      }
    }
  } catch (e) {
    console.error("[cancelMemberActiveSubscriptions] list failed", memberId, e);
    return {
      canceled: 0,
      billingCleanupPending: true,
      configured: true,
      noCustomer: false,
      ok: false,
    };
  }

  if (toCancel.length === 0) {
    try {
      await syncStripeSubscriptionsForMember(memberId, stripe);
    } catch (e) {
      console.error("[cancelMemberActiveSubscriptions] sync failed", memberId, e);
      return {
        canceled: 0,
        billingCleanupPending: true,
        configured: true,
        noCustomer: false,
        ok: false,
      };
    }
    const stillBillable = await memberHasBillableLocalSubscription(memberId);
    return {
      canceled: 0,
      billingCleanupPending: stillBillable,
      configured: true,
      noCustomer: false,
      ok: true,
    };
  }

  const atPeriodEnd = options?.atPeriodEnd === true;
  let canceled = 0;
  try {
    for (const sub of toCancel) {
      if (atPeriodEnd) {
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.cancel(sub.id);
      }
      canceled += 1;
    }
  } catch (e) {
    console.error("[cancelMemberActiveSubscriptions] cancel failed", memberId, e);
    return {
      canceled,
      billingCleanupPending: true,
      configured: true,
      noCustomer: false,
      ok: false,
    };
  }

  try {
    await syncStripeSubscriptionsForMember(memberId, stripe);
  } catch (e) {
    console.error("[cancelMemberActiveSubscriptions] sync failed", memberId, e);
    return {
      canceled,
      billingCleanupPending: true,
      configured: true,
      noCustomer: false,
      ok: false,
    };
  }

  const stillBillable = await memberHasBillableLocalSubscription(memberId);
  return {
    canceled,
    billingCleanupPending: stillBillable,
    configured: true,
    noCustomer: false,
    ok: true,
  };
}
