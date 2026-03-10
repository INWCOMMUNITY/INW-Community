import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

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
  const order = await prisma.storeOrder.findUnique({
    where: { id },
    include: {
      buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
      seller: {
        select: { id: true, firstName: true, lastName: true },
        include: { businesses: { take: 1, select: { name: true, slug: true } } },
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

  // For buyer: do not expose stripePaymentIntentId; add isCashOrder for UI (cancel vs request refund).
  if (order.buyerId === userId) {
    const { stripePaymentIntentId, ...rest } = order;
    return NextResponse.json({ ...rest, isCashOrder: !stripePaymentIntentId });
  }
  return NextResponse.json(order);
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
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.sellerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { status?: string; deliveryConfirmed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: { status?: string; deliveryConfirmedAt?: Date | null } = {};
  if (body.deliveryConfirmed === true) {
    update.deliveryConfirmedAt = new Date();
  }
  if (body.status) {
    const validStatuses = ["paid", "shipped", "delivered", "refunded", "canceled"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    // Only allow shipping/delivery transitions from the correct prior status
    if (body.status === "shipped" && existing.status !== "paid") {
      return NextResponse.json(
        { error: "Order must be paid before it can be marked shipped." },
        { status: 400 }
      );
    }
    if (body.status === "delivered" && existing.status !== "shipped") {
      return NextResponse.json(
        { error: "Order must be shipped before it can be marked delivered." },
        { status: 400 }
      );
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid update" }, { status: 400 });
  }

  const order = await prisma.storeOrder.update({
    where: { id },
    data: update,
  });
  const shouldAwardBadges =
    (update.status === "delivered" || update.deliveryConfirmedAt) && order.sellerId;

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
