import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, type Plan } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveStripeCustomerIdForMember } from "@/lib/stripe-customer-for-member";
import { stripeSubscriptionStatusToDb } from "@/lib/stripe-subscription-db-status";
import { planFromStripePriceId } from "@/lib/stripe-price-to-plan";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

/**
 * Pull subscriptions from Stripe for the signed-in member's customer and upsert local rows.
 * Use when webhooks lag/fail or the DB is out of sync — no new purchase required.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const memberId = session.user.id;
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { email: true, stripeCustomerId: true },
  });
  if (!member?.email?.trim()) {
    return NextResponse.json({ error: "Member email required" }, { status: 400 });
  }

  let customerId = await resolveStripeCustomerIdForMember(memberId);

  if (!customerId?.trim()) {
    try {
      const found = await stripe.customers.list({ email: member.email.trim(), limit: 5 });
      if (found.data.length === 1) {
        customerId = found.data[0].id;
        await prisma.member.update({
          where: { id: memberId },
          data: { stripeCustomerId: customerId },
        });
      }
    } catch (e) {
      console.warn("[sync-subscriptions] customer list by email failed", e);
    }
  }

  if (!customerId?.trim()) {
    return NextResponse.json({
      ok: true,
      synced: 0,
      message: "No Stripe customer found for this account. If you subscribed recently, wait a minute and try again.",
    });
  }

  try {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });

    let synced = 0;
    const memberEmail = member.email.trim().toLowerCase();

    for (const sub of list.data) {
      const metaMember = sub.metadata?.memberId?.trim();
      if (metaMember && metaMember !== memberId) {
        continue;
      }
      if (!metaMember) {
        let custEmail: string | null = null;
        const c = sub.customer;
        if (typeof c === "string") {
          const cust = await stripe.customers.retrieve(c);
          if (!("deleted" in cust) && cust.email) {
            custEmail = cust.email.trim().toLowerCase();
          }
        } else if (c && typeof c === "object" && !("deleted" in c) && "email" in c) {
          const e = (c as Stripe.Customer).email;
          custEmail = e ? e.trim().toLowerCase() : null;
        }
        if (custEmail !== memberEmail) {
          continue;
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
      if (!plan) continue;

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
          synced += 1;
        }
        continue;
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
      synced += 1;
    }

    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    console.error("[sync-subscriptions]", e);
    const msg = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
