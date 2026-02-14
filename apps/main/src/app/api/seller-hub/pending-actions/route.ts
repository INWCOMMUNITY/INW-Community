import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const MIN_PAYOUT_CENTS = 100;

/** Returns counts of actions needing seller attention (ship, returns, payout ready) for sidebar indicators. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ pendingShip: 0, pendingReturns: 0, payoutReady: false }, { status: 200 });
    }
    const sub = await prisma.subscription.findFirst({
      where: { memberId: userId, plan: "seller", status: "active" },
    });
    if (!sub) {
      return NextResponse.json({ pendingShip: 0, pendingReturns: 0, payoutReady: false }, { status: 200 });
    }
    const [pendingShip, pendingReturns, balance, member] = await Promise.all([
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          status: "paid",
          shipment: null,
          shippedWithOrderId: null,
        },
      }),
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          refundRequestedAt: { not: null },
        },
      }),
      prisma.sellerBalance.findUnique({
        where: { memberId: userId },
        select: { balanceCents: true },
      }),
      prisma.member.findUnique({
        where: { id: userId },
        select: { stripeConnectAccountId: true },
      }),
    ]);
    const hasStripeConnect = !!member?.stripeConnectAccountId;
    const balanceCents = balance?.balanceCents ?? 0;
    const payoutReady = hasStripeConnect && balanceCents >= MIN_PAYOUT_CENTS;
    return NextResponse.json({ pendingShip, pendingReturns, payoutReady });
  } catch {
    return NextResponse.json({ pendingShip: 0, pendingReturns: 0, payoutReady: false }, { status: 200 });
  }
}
