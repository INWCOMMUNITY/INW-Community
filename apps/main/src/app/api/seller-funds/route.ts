import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: { in: ["seller", "subscribe"] }, status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller or Subscribe plan required" }, { status: 403 });
  }

  const balance = await prisma.sellerBalance.findUnique({
    where: { memberId: userId },
  });
  const transactions = await prisma.sellerBalanceTransaction.findMany({
    where: { memberId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });

  let hasStripeConnect = false;
  let availableForPayoutCents: number | undefined;
  let pendingCents: number | undefined;
  let payoutScheduleDescription: string | undefined;

  if (member?.stripeConnectAccountId) {
    try {
      const account = await stripe.accounts.retrieve(member.stripeConnectAccountId);
      hasStripeConnect = account.charges_enabled === true;
      const stripeBalance = await stripe.balance.retrieve({
        stripeAccount: member.stripeConnectAccountId,
      });
      const usdAvailable = stripeBalance.available?.find((b) => b.currency === "usd");
      const usdPending = stripeBalance.pending?.find((b) => b.currency === "usd");
      availableForPayoutCents = usdAvailable?.amount ?? 0;
      pendingCents = usdPending?.amount ?? 0;
      const schedule = account.settings?.payouts?.schedule;
      if (schedule) {
        const delay = schedule.delay_days ?? 2;
        const interval = schedule.interval ?? "daily";
        if (interval === "daily") {
          payoutScheduleDescription =
            delay <= 0
              ? "Funds are available immediately"
              : `Funds typically available in ${delay} business day${delay === 1 ? "" : "s"}`;
        } else if (interval === "weekly" && schedule.weekly_anchor) {
          payoutScheduleDescription = `Payouts weekly on ${schedule.weekly_anchor}`;
        } else if (interval === "monthly") {
          payoutScheduleDescription = "Payouts monthly";
        } else {
          payoutScheduleDescription = `Funds typically available in ${delay} business days`;
        }
      } else {
        payoutScheduleDescription = "Funds typically available in 2 business days";
      }
    } catch {
      hasStripeConnect = false;
    }
  }

  return NextResponse.json({
    balanceCents: balance?.balanceCents ?? 0,
    totalEarnedCents: balance?.totalEarnedCents ?? 0,
    totalPaidOutCents: balance?.totalPaidOutCents ?? 0,
    transactions,
    hasStripeConnect,
    ...(availableForPayoutCents !== undefined && { availableForPayoutCents }),
    ...(pendingCents !== undefined && { pendingCents }),
    ...(payoutScheduleDescription !== undefined && { payoutScheduleDescription }),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: { in: ["seller", "subscribe"] }, status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller or Subscribe plan required" }, { status: 403 });
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });
  if (!member?.stripeConnectAccountId) {
    return NextResponse.json(
      { error: "Complete Stripe Connect setup to receive payouts" },
      { status: 400 }
    );
  }

  let availableCents: number;
  try {
    const stripeBalance = await stripe.balance.retrieve({
      stripeAccount: member.stripeConnectAccountId,
    });
    const usdAvailable = stripeBalance.available?.find((b) => b.currency === "usd");
    availableCents = usdAvailable?.amount ?? 0;
  } catch {
    return NextResponse.json({ error: "Could not load your Stripe balance" }, { status: 500 });
  }

  if (availableCents < 100) {
    return NextResponse.json(
      { error: "Minimum payout is $1.00. No funds available for payout yet." },
      { status: 400 }
    );
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount: availableCents,
        currency: "usd",
        metadata: { memberId: userId },
      },
      { stripeAccount: member.stripeConnectAccountId }
    );
    return NextResponse.json({ ok: true, payoutId: payout.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Payout failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
