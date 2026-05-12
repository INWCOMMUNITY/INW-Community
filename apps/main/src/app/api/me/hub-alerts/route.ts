import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";

export const dynamic = "force-dynamic";

/**
 * Lightweight flags for profile hub switcher badges.
 * Client combines with plan flags: Seller Hub uses hasSeller, Resale Hub uses hasSubscriber.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const [pendingSellerOffers, buyerCounteredOffers, incompleteLocalDeliverySeller, pickupAttentionSeller] =
      await Promise.all([
        prisma.resaleOffer.count({
          where: { status: "pending", storeItem: { memberId: userId } },
        }),
        prisma.resaleOffer.count({
          where: { buyerId: userId, status: "countered" },
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
      ]);

    const paidOrdersSeller = await prisma.storeOrder.findMany({
      where: { sellerId: userId, status: "paid" },
      select: {
        shippedWithOrderId: true,
        shipment: { select: { id: true } },
        items: { select: { fulfillmentType: true } },
      },
    });
    const needsShipment = paidOrdersSeller.filter(
      (o) =>
        !o.shipment?.id &&
        !o.shippedWithOrderId &&
        orderHasShippedLine(o.items)
    ).length;

    const sellerOffersPending = pendingSellerOffers > 0;
    const buyerOffersAction = buyerCounteredOffers > 0;
    const sellerFulfillmentPending =
      incompleteLocalDeliverySeller > 0 || pickupAttentionSeller > 0 || needsShipment > 0;

    return NextResponse.json({
      sellerOffersPending,
      buyerOffersAction,
      sellerFulfillmentPending,
    });
  } catch (e) {
    console.error("[hub-alerts]", e);
    return NextResponse.json({
      sellerOffersPending: false,
      buyerOffersAction: false,
      sellerFulfillmentPending: false,
    });
  }
}
