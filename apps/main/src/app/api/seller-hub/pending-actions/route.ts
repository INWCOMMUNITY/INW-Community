import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const MIN_PAYOUT_CENTS = 100;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

/** Returns counts of actions needing seller attention (ship, returns, payout ready, sold count) for sidebar indicators. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ pendingShip: 0, pendingReturns: 0, payoutReady: false, soldCount: 0 }, { status: 200 });
    }
    const sub = await prisma.subscription.findFirst({
      where: { memberId: userId, plan: "seller", status: "active" },
    });
    if (!sub) {
      return NextResponse.json({ pendingShip: 0, pendingReturns: 0, payoutReady: false, soldCount: 0 }, { status: 200 });
    }
    const [pendingShip, pendingReturns, balance, member, soldCount] = await Promise.all([
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
      prisma.storeItem.count({
        where: { memberId: userId, status: "sold_out" },
      }),
    ]);
    const hasStripeConnect = !!member?.stripeConnectAccountId;
    const balanceCents = balance?.balanceCents ?? 0;
    let stripeAvailableCents = 0;
    if (member?.stripeConnectAccountId) {
      try {
        const stripeBalance = await stripe.balance.retrieve({
          stripeAccount: member.stripeConnectAccountId,
        });
        const usdAvailable = stripeBalance.available?.find((b) => b.currency === "usd");
        stripeAvailableCents = usdAvailable?.amount ?? 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const accountGone = /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(msg);
        if (accountGone) {
          await prisma.member.update({
            where: { id: userId },
            data: { stripeConnectAccountId: null },
          }).catch(() => {});
        }
        // use balanceCents only
      }
    }
    const payoutReady =
      hasStripeConnect && (stripeAvailableCents >= MIN_PAYOUT_CENTS || balanceCents >= MIN_PAYOUT_CENTS);
    return NextResponse.json({ pendingShip, pendingReturns, payoutReady, soldCount: soldCount ?? 0 });
  } catch {
    return NextResponse.json({ pendingShip: 0, pendingReturns: 0, payoutReady: false, soldCount: 0 }, { status: 200 });
  }
}
