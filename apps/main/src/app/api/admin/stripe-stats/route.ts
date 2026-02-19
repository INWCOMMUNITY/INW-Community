import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireAdmin } from "@/lib/admin-auth";

const stripe =
  process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2024-11-20.acacia" as "2023-10-16",
      })
    : null;

const PRICE_IDS = [
  process.env.STRIPE_PRICE_SUBSCRIBE,
  process.env.STRIPE_PRICE_SPONSOR,
  process.env.STRIPE_PRICE_SELLER,
  process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY,
  process.env.STRIPE_PRICE_SPONSOR_YEARLY,
  process.env.STRIPE_PRICE_SELLER_YEARLY,
].filter(Boolean) as string[];

function startOfMonth(d: Date) {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
}

function endOfMonth(d: Date) {
  return Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime() / 1000);
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!stripe || PRICE_IDS.length === 0) {
    return NextResponse.json({
      subscriptionRevenueCents: 0,
      subscriptionRevenueThisMonthCents: 0,
    });
  }

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  let totalCents = 0;
  let thisMonthCents = 0;

  try {
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const invoices = await stripe.invoices.list({
        status: "paid",
        limit: 100,
        starting_after: startingAfter,
        expand: ["data.lines.data.price"],
      });

      for (const inv of invoices.data) {
        if (!inv.subscription) continue;

        const amountPaid = inv.amount_paid ?? 0;

        const isOurPrice =
          PRICE_IDS.length === 0 ||
          inv.lines?.data?.some((line) => {
            const p = line.price;
            const id = p && typeof p === "object" && "id" in p ? (p as { id: string }).id : null;
            return id && PRICE_IDS.includes(id);
          });

        if (!isOurPrice) continue;

        totalCents += amountPaid;

        const paidAt = inv.status_transitions?.paid_at ?? inv.created;
        if (paidAt && paidAt >= monthStart && paidAt <= monthEnd) {
          thisMonthCents += amountPaid;
        }
      }

      hasMore = invoices.has_more && invoices.data.length > 0;
      if (hasMore && invoices.data.length) {
        startingAfter = invoices.data[invoices.data.length - 1]?.id;
      }
    }

    return NextResponse.json({
      subscriptionRevenueCents: totalCents,
      subscriptionRevenueThisMonthCents: thisMonthCents,
    });
  } catch (e) {
    console.error("[stripe-stats]", e);
    return NextResponse.json({
      subscriptionRevenueCents: 0,
      subscriptionRevenueThisMonthCents: 0,
      error: "Failed to fetch Stripe data",
    });
  }
}
