import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

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
