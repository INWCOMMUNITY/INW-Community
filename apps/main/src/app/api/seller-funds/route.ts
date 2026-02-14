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
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  const balance = await prisma.sellerBalance.findUnique({
    where: { memberId: userId },
  });
  const transactions = await prisma.sellerBalanceTransaction.findMany({
    where: { memberId: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const connectStatus = await prisma.member.findUnique({
    where: { id: userId },
    select: { stripeConnectAccountId: true },
  });

  return NextResponse.json({
    balanceCents: balance?.balanceCents ?? 0,
    totalEarnedCents: balance?.totalEarnedCents ?? 0,
    totalPaidOutCents: balance?.totalPaidOutCents ?? 0,
    transactions,
    hasStripeConnect: !!connectStatus?.stripeConnectAccountId,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
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

  const balance = await prisma.sellerBalance.findUnique({
    where: { memberId: userId },
  });
  const availableCents = balance?.balanceCents ?? 0;
  if (availableCents < 100) {
    return NextResponse.json(
      { error: "Minimum payout is $1.00" },
      { status: 400 }
    );
  }

  try {
    const transfer = await stripe.transfers.create({
      amount: availableCents,
      currency: "usd",
      destination: member.stripeConnectAccountId,
      metadata: { memberId: userId },
    });

    await prisma.sellerBalance.update({
      where: { memberId: userId },
      data: {
        balanceCents: 0,
        totalPaidOutCents: { increment: availableCents },
      },
    });
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: userId,
        type: "payout",
        amountCents: -availableCents,
        stripeTransferId: transfer.id,
        description: `Payout to bank: $${(availableCents / 100).toFixed(2)}`,
      },
    });

    return NextResponse.json({ ok: true, transferId: transfer.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Payout failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
