import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";

const MIN_PAYOUT_CENTS = 100;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

const emptyPending = {
  pendingShip: 0,
  pendingDeliveries: 0,
  pendingPickups: 0,
  sellerOffersPending: 0,
  pendingReturns: 0,
  payoutReady: false,
  soldCount: 0,
  payoutSetupComplete: false,
};

/** Returns counts of actions needing seller attention (ship, deliveries, pickups, offers, returns, payout) for hub badges. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(emptyPending, { status: 200 });
    }
    const [
      paidOrdersUnshipped,
      pendingDeliveries,
      pendingPickups,
      sellerOffersPending,
      pendingReturns,
      balance,
      member,
      soldCount,
    ] = await Promise.all([
      prisma.storeOrder.findMany({
        where: {
          sellerId: userId,
          status: "paid",
          shipment: null,
          shippedWithOrderId: null,
        },
        select: { items: { select: { fulfillmentType: true } } },
      }),
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          status: { in: ["paid", "shipped"] },
          localDeliveryDetails: { not: Prisma.DbNull },
          OR: [{ deliveryConfirmedAt: null }, { deliveryBuyerConfirmedAt: null }],
        },
      }),
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          status: { in: ["paid", "shipped"] },
          items: { some: { fulfillmentType: "pickup" } },
          OR: [{ pickupSellerConfirmedAt: null }, { pickupBuyerConfirmedAt: null }],
        },
      }),
      prisma.resaleOffer.count({
        where: { status: "pending", storeItem: { memberId: userId } },
      }),
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          refundRequestedAt: { not: null },
          status: { not: "refunded" },
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
    const pendingShip = paidOrdersUnshipped.filter((o) => orderHasShippedLine(o.items)).length;
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
    return NextResponse.json({
      pendingShip,
      pendingDeliveries,
      pendingPickups,
      sellerOffersPending,
      pendingReturns,
      payoutReady,
      soldCount: soldCount ?? 0,
      payoutSetupComplete: hasStripeConnect,
    });
  } catch {
    return NextResponse.json(emptyPending, { status: 200 });
  }
}
