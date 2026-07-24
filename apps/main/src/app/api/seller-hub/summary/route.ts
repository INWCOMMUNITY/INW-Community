import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";
import { getCircuitStatus } from "@/lib/channels/circuit-breaker";

const MIN_PAYOUT_CENTS = 100;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

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
  syncHealth: null,
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
      syncHealthData,
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
      prisma.storeOrder.count({
        where: {
          sellerId: userId,
          refundRequestedAt: { not: null },
          status: { not: "refunded" },
        },
      }),
      prisma.sellerBalance.findUnique({
        where: { memberId: userId },
        select: { balanceCents: true, totalEarnedCents: true },
      }),
      prisma.member.findUnique({
        where: { id: userId },
        select: { stripeConnectAccountId: true },
      }),
      prisma.storeItem.count({
        where: { memberId: userId, status: "sold_out" },
      }),
    ]);

    // Sync health inline computation
    const connections = await prisma.channelConnection.findMany({
      where: { memberId: userId, status: { not: "disconnected" } },
      select: {
        id: true,
        provider: true,
        status: true,
        _count: { select: { listingLinks: { where: { syncStatus: "error" } } } },
      },
    });

    const retryQueueDepths = await prisma.channelSyncRetry.groupBy({
      by: ["provider"],
      where: { link: { connection: { memberId: userId } } },
      _count: { id: true },
    });

    type ChannelHealth = {
      provider: string;
      status: "healthy" | "degraded" | "error" | "paused";
      errorCount: number;
      retryQueueDepth: number;
    };

    const channelHealthList: ChannelHealth[] = connections.map((conn) => {
      const retryEntry = retryQueueDepths.find((r) => r.provider === conn.provider);
      const retryDepth = retryEntry?._count.id ?? 0;
      const errorCount = conn._count.listingLinks;
      const circuitStatus = getCircuitStatus(conn.id);

      let status: ChannelHealth["status"] = "healthy";
      if (circuitStatus.state === "OPEN") status = "paused";
      else if (conn.status === "error" || errorCount > 0) status = "error";
      else if (retryDepth > 0 || circuitStatus.state === "HALF_OPEN") status = "degraded";

      return { provider: conn.provider, status, errorCount, retryQueueDepth: retryDepth };
    });

    const totalErrors = channelHealthList.reduce((sum, c) => sum + c.errorCount, 0);
    const totalRetries = channelHealthList.reduce((sum, c) => sum + c.retryQueueDepth, 0);

    let overallHealth: "healthy" | "attention_needed" | "degraded" = "healthy";
    if (channelHealthList.some((c) => c.status === "error" || c.status === "paused")) {
      overallHealth = "attention_needed";
    } else if (channelHealthList.some((c) => c.status === "degraded")) {
      overallHealth = "degraded";
    }

    const syncHealthData = connections.length > 0 ? {
      overall: overallHealth,
      channels: channelHealthList,
      totalErrors,
      totalRetries,
    } : null;

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
      }
    }

    const payoutReady =
      hasStripeConnect && (stripeAvailableCents >= MIN_PAYOUT_CENTS || balanceCents >= MIN_PAYOUT_CENTS);

    return NextResponse.json({
      pendingActions: {
        pendingShip,
        pendingDeliveries,
        pendingPickups,
        sellerOffersPending,
        pendingReturns,
        payoutReady,
        soldCount: soldCount ?? 0,
        payoutSetupComplete: hasStripeConnect,
      },
      syncHealth: syncHealthData,
      funds: {
        balanceCents,
        totalEarnedCents: balance?.totalEarnedCents ?? 0,
        hasStripeConnect,
        availableForPayoutCents: stripeAvailableCents,
      },
    });
  } catch {
    return NextResponse.json(emptyResponse, { status: 200 });
  }
}
