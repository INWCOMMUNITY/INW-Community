import Stripe from "stripe";
import { prisma, type Plan } from "database";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { stripeSubscriptionStatusToDb } from "@/lib/stripe-subscription-db-status";
import { planFromStripePriceId } from "@/lib/stripe-price-to-plan";

export type SyncStripeSubscriptionsResult = {
  synced: number;
  fromMetadataSearch: number;
  fromCustomerLists: number;
  message?: string;
};

async function resolveCustomerEmail(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
  stripe: Stripe
): Promise<string | null> {
  if (typeof customer === "object" && customer && "deleted" in customer && customer.deleted) {
    return null;
  }
  if (typeof customer === "object" && customer && "email" in customer) {
    const e = (customer as Stripe.Customer).email;
    return e ? e.trim().toLowerCase() : null;
  }
  if (typeof customer === "string") {
    const cust = await stripe.customers.retrieve(customer);
    if ("deleted" in cust && cust.deleted) return null;
    const e = cust.email;
    return e ? e.trim().toLowerCase() : null;
  }
  return null;
}

/**
 * Upsert one Stripe subscription into our DB. Returns 1 if a row was created or meaningfully updated.
 */
async function upsertSubscriptionRow(
  memberId: string,
  sub: Stripe.Subscription,
  memberEmail: string,
  stripe: Stripe
): Promise<number> {
  const metaMember = sub.metadata?.memberId?.trim();
  if (metaMember && metaMember !== memberId) {
    return 0;
  }
  if (!metaMember) {
    const custEmail = await resolveCustomerEmail(sub.customer, stripe);
    if (custEmail !== memberEmail) {
      return 0;
    }
  }

  let plan: Plan | null = null;
  const metaPlan = sub.metadata?.planId?.trim();
  if (metaPlan === "subscribe" || metaPlan === "sponsor" || metaPlan === "seller") {
    plan = metaPlan as Plan;
  } else {
    const rawPrice = sub.items.data[0]?.price;
    const priceId = typeof rawPrice === "string" ? rawPrice : rawPrice?.id ?? null;
    plan = planFromStripePriceId(priceId);
  }
  if (!plan) {
    return 0;
  }

  const mapped = stripeSubscriptionStatusToDb(sub.status);
  const stripeCust =
    typeof sub.customer === "string"
      ? sub.customer
      : sub.customer && typeof sub.customer === "object" && "id" in sub.customer
        ? (sub.customer as Stripe.Customer).id
        : null;
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

  const existing = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: sub.id },
  });

  if (mapped === null) {
    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          currentPeriodEnd: periodEnd,
          ...(stripeCust ? { stripeCustomerId: stripeCust } : {}),
        },
      });
      return 1;
    }
    return 0;
  }

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        memberId,
        plan,
        status: mapped,
        currentPeriodEnd: periodEnd,
        ...(stripeCust ? { stripeCustomerId: stripeCust } : {}),
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        memberId,
        plan,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: stripeCust,
        status: mapped,
        currentPeriodEnd: periodEnd,
      },
    });
  }
  return 1;
}

/**
 * Find every Stripe subscription that should belong to this member (metadata and/or shared customers by email)
 * and mirror into the database. Handles split Stripe customers with the same email.
 */
export async function syncStripeSubscriptionsForMember(
  memberId: string,
  stripe: Stripe
): Promise<SyncStripeSubscriptionsResult> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { email: true, stripeCustomerId: true },
  });
  if (!member?.email?.trim()) {
    return {
      synced: 0,
      fromMetadataSearch: 0,
      fromCustomerLists: 0,
      message: "Member email missing",
    };
  }
  const memberEmail = member.email.trim().toLowerCase();

  const seen = new Set<string>();
  let synced = 0;
  let fromMetadataSearch = 0;
  let fromCustomerLists = 0;

  try {
    for await (const sub of stripe.subscriptions.search({
      query: `metadata['memberId']:'${memberId}'`,
      limit: 100,
    })) {
      if (seen.has(sub.id)) continue;
      seen.add(sub.id);
      const n = await upsertSubscriptionRow(memberId, sub, memberEmail, stripe);
      synced += n;
      fromMetadataSearch += n;
    }
  } catch (e) {
    console.warn("[syncStripeSubscriptionsForMember] subscriptions.search failed (falling back to customers)", e);
  }

  const customerIds: string[] = [];
  const resolved = await resolveStripeCustomerIdForMember(memberId);
  if (resolved?.trim()) {
    customerIds.push(resolved.trim());
  }

  let emailCustomers: Stripe.Customer[] = [];
  try {
    const found = await stripe.customers.list({ email: member.email.trim(), limit: 100 });
    emailCustomers = found.data;
    for (const c of found.data) {
      if (!customerIds.includes(c.id)) {
        customerIds.push(c.id);
      }
    }
  } catch (e) {
    console.warn("[syncStripeSubscriptionsForMember] customers.list failed", e);
  }

  if (!member.stripeCustomerId?.trim() && emailCustomers.length === 1) {
    await prisma.member.update({
      where: { id: memberId },
      data: { stripeCustomerId: emailCustomers[0].id },
    });
  }

  for (const custId of customerIds) {
    try {
      const list = await stripe.subscriptions.list({
        customer: custId,
        status: "all",
        limit: 100,
      });
      for (const sub of list.data) {
        if (seen.has(sub.id)) continue;
        const metaMember = sub.metadata?.memberId?.trim();
        if (metaMember && metaMember !== memberId) {
          continue;
        }
        if (!metaMember) {
          const custEmail = await resolveCustomerEmail(sub.customer, stripe);
          if (custEmail !== memberEmail) {
            continue;
          }
        }
        seen.add(sub.id);
        const n = await upsertSubscriptionRow(memberId, sub, memberEmail, stripe);
        synced += n;
        fromCustomerLists += n;
      }
    } catch (e) {
      console.warn("[syncStripeSubscriptionsForMember] subscriptions.list failed for customer", custId, e);
    }
  }

  if (synced === 0 && customerIds.length === 0) {
    return {
      synced: 0,
      fromMetadataSearch,
      fromCustomerLists,
      message:
        "No Stripe customer or subscriptions found for this account. Confirm you use the same email as in Stripe checkout, or check Stripe Dashboard → Customers.",
    };
  }

  return { synced, fromMetadataSearch, fromCustomerLists };
}
