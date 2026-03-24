import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  isLocalDeliveryFullyConfirmed,
  isPickupFullyConfirmed,
  nextStatusAfterFulfillmentConfirmations,
  orderHasShippedLine,
  orderPaymentLabel,
} from "@/lib/store-order-fulfillment";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(_req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const order = await prisma.storeOrder.findUnique({
      where: { id },
      include: {
        buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
        seller: {
          include: {
            businesses: { take: 1, select: { name: true, slug: true } },
          },
        },
        items: {
          include: {
            storeItem: { select: { id: true, title: true, slug: true, photos: true, description: true, listingType: true } },
          },
        },
        shipment: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (order.sellerId !== userId && order.buyerId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const paymentLabel = orderPaymentLabel(order);

    // For buyer: do not expose stripePaymentIntentId; add isCashOrder for UI (cancel vs request refund).
    if (order.buyerId === userId) {
      const { stripePaymentIntentId, ...rest } = order;
      return NextResponse.json({
        ...rest,
        isCashOrder: !stripePaymentIntentId,
        orderNumber: order.id.slice(-8).toUpperCase(),
        paymentLabel,
      });
    }
    return NextResponse.json({
      ...order,
      orderNumber: order.id.slice(-8).toUpperCase(),
      paymentLabel,
    });
  } catch (e) {
    console.error("[store-orders GET]", e);
    const msg = e instanceof Error ? e.message : "Failed to load order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.storeOrder.findUnique({
    where: { id },
    include: { items: { select: { fulfillmentType: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const prevStatus: string = existing.status;
  const isSeller = existing.sellerId === userId;
  const isBuyer = existing.buyerId === userId;
  if (!isSeller && !isBuyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    status?: string;
    deliveryConfirmed?: boolean;
    pickupSellerConfirmed?: boolean;
    pickupBuyerConfirmed?: boolean;
    deliveryBuyerConfirmed?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!["paid", "shipped", "delivered"].includes(prevStatus)) {
    return NextResponse.json(
      { error: "This order cannot be updated (must be paid, shipped, or delivered)." },
      { status: 400 }
    );
  }

  const data: {
    status?: string;
    deliveryConfirmedAt?: Date;
    deliveryBuyerConfirmedAt?: Date;
    pickupSellerConfirmedAt?: Date;
    pickupBuyerConfirmedAt?: Date;
  } = {};

  if (isBuyer) {
    if (
      body.status !== undefined ||
      body.deliveryConfirmed !== undefined ||
      body.pickupSellerConfirmed !== undefined
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (body.pickupBuyerConfirmed === true) {
      data.pickupBuyerConfirmedAt = new Date();
    }
    if (body.deliveryBuyerConfirmed === true) {
      data.deliveryBuyerConfirmedAt = new Date();
    }
  }

  if (isSeller) {
    if (body.pickupBuyerConfirmed !== undefined || body.deliveryBuyerConfirmed !== undefined) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (body.deliveryConfirmed === true) {
      data.deliveryConfirmedAt = new Date();
    }
    if (body.pickupSellerConfirmed === true) {
      data.pickupSellerConfirmedAt = new Date();
    }
    if (body.status) {
      const validStatuses = ["shipped", "delivered"];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      if (!orderHasShippedLine(existing.items)) {
        return NextResponse.json(
          { error: "This order does not use shipped status; use pickup or delivery confirmations." },
          { status: 400 }
        );
      }
      if (body.status === "shipped") {
        if (prevStatus !== "paid") {
          return NextResponse.json(
            { error: "Order must be paid before it can be marked shipped." },
            { status: 400 }
          );
        }
        data.status = "shipped";
      } else if (body.status === "delivered") {
        if (prevStatus !== "shipped") {
          return NextResponse.json(
            { error: "Order must be shipped before it can be marked delivered." },
            { status: 400 }
          );
        }
        data.status = "delivered";
      }
    }
  }

  const merged = {
    ...existing,
    ...data,
    deliveryConfirmedAt: data.deliveryConfirmedAt ?? existing.deliveryConfirmedAt,
    deliveryBuyerConfirmedAt: data.deliveryBuyerConfirmedAt ?? existing.deliveryBuyerConfirmedAt,
    pickupSellerConfirmedAt: data.pickupSellerConfirmedAt ?? existing.pickupSellerConfirmedAt,
    pickupBuyerConfirmedAt: data.pickupBuyerConfirmedAt ?? existing.pickupBuyerConfirmedAt,
  };
  const autoStatus = nextStatusAfterFulfillmentConfirmations(merged, existing.items);
  if (autoStatus) {
    data.status = autoStatus;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid update" }, { status: 400 });
  }

  const order = await prisma.storeOrder.update({
    where: { id },
    data,
  });

  const deliveryJustCompleted =
    isLocalDeliveryFullyConfirmed(order) &&
    !(existing.deliveryConfirmedAt && existing.deliveryBuyerConfirmedAt);
  const pickupJustCompleted =
    isPickupFullyConfirmed(order) &&
    !(existing.pickupSellerConfirmedAt && existing.pickupBuyerConfirmedAt);

  const statusBecameDelivered =
    order.status === "delivered" && (prevStatus === "paid" || prevStatus === "shipped");
  const shouldAwardBadges =
    order.sellerId && (statusBecameDelivered || deliveryJustCompleted || pickupJustCompleted);

  let earnedBadges: { slug: string; name: string; description: string }[] = [];
  if (shouldAwardBadges) {
    const { awardSellerTierBadges, awardSellerDeliveryBadge, awardSellerPickupBadge } = await import("@/lib/badge-award");
    try {
      const [tierBadges, deliveryBadges, pickupBadges] = await Promise.all([
        awardSellerTierBadges(order.sellerId!),
        awardSellerDeliveryBadge(order.sellerId!),
        awardSellerPickupBadge(order.sellerId!),
      ]);
      earnedBadges = [...tierBadges, ...deliveryBadges, ...pickupBadges];
    } catch {
      // badge errors shouldn't block order update
    }
  }
  return NextResponse.json({ ...order, earnedBadges });
}
