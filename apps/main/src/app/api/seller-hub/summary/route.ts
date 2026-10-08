import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";
import { whereNoCurrentOutboundShipment } from "@/lib/store-order-shipments";
import { ACTIVE_STORE_RETURN_STATUSES } from "@/lib/store-return";
import { tryCreateMarketplaceStripe } from "@/lib/stripe-clients";
import { retrieveConnectAccountOrHeal } from "@/lib/stripe-connect-account-gone";

const MIN_PAYOUT_CENTS = 100;

const stripe = tryCreateMarketplaceStripe();

export const dynamic = "force-dynamic";

const emptyResponse = {
  pendingActions: {
    pendingShip: 0,
    pendingDeliveries: 0,
    pendingPickups: 0,
    sellerOffersPending: 0,
    pendingReturns: 0,
    payoutReady: false,
    soldCount: 0,
    payoutSetupComplete: false,
  },
  funds: {
    balanceCents: 0,
    totalEarnedCents: 0,
    hasStripeConnect: false,
    availableForPayoutCents: 0,
  },
};

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(emptyResponse, { status: 200 });
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
          ...whereNoCurrentOutboundShipment,
          shippedWithOrderId: null,
        },
        select: { items: { select: { fulfillmentType: true } } },
      }),
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          status: { in: ["paid", "shipped"] },
          items: { some: { fulfillmentType: "local_delivery" } },
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
      prisma.storeReturn.count({
        where: {
          status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
          order: { sellerId: userId },
        },
      }),
      prisma.sellerBalance.findUnique({
        where: { memberId: userId },
        select: { balanceCents: true, totalEarnedCents: true },
      }),
      prisma.member.findUnique({
        where: { id: userId },
        select: { stripeConnectAccountId: true, email: true },
      }),
      prisma.storeItem.count({
        where: { memberId: userId, status: "sold_out" },
      }),
    ]);

    const pendingShip = paidOrdersUnshipped.filter((o) => orderHasShippedLine(o.items)).length;
    let chargesEnabled = false;
    const balanceCents = balance?.balanceCents ?? 0;
    let stripeAvailableCents = 0;

    if (member?.stripeConnectAccountId && stripe) {
      const healed = await retrieveConnectAccountOrHeal({
        stripe,
        memberId: userId,
        email: member.email,
        accountId: member.stripeConnectAccountId,
      });
      if (healed.ok) {
        chargesEnabled = healed.account.charges_enabled === true;
        try {
          const stripeBalance = await stripe.balance.retrieve({
            stripeAccount: healed.accountId,
          });
          const usdAvailable = stripeBalance.available?.find((b) => b.currency === "usd");
          stripeAvailableCents = usdAvailable?.amount ?? 0;
        } catch {
          // Balance failures must not clear Connect.
        }
      } else if (!healed.cleared) {
        // Transient Stripe error — keep Connect treated as linked for hub UI.
        chargesEnabled = true;
      }
    }

    const payoutReady = chargesEnabled && stripeAvailableCents >= MIN_PAYOUT_CENTS;

    return NextResponse.json({
      pendingActions: {
        pendingShip,
        pendingDeliveries,
        pendingPickups,
        sellerOffersPending,
        pendingReturns,
        payoutReady,
        soldCount: soldCount ?? 0,
        payoutSetupComplete: chargesEnabled,
      },
      funds: {
        balanceCents,
        totalEarnedCents: balance?.totalEarnedCents ?? 0,
        hasStripeConnect: chargesEnabled,
        availableForPayoutCents: stripeAvailableCents,
      },
    });
  } catch {
    return NextResponse.json(emptyResponse, { status: 200 });
  }
}
