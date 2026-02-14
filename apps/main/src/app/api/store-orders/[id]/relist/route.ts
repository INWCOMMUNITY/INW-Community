import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * Seller re-lists items from a canceled cash order. Restores inventory so items can be sold again.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "canceled") {
    return NextResponse.json(
      { error: "Only canceled orders can be re-listed." },
      { status: 400 }
    );
  }
  if (order.stripePaymentIntentId) {
    return NextResponse.json(
      { error: "Re-list is only for canceled cash orders. Card orders were already refunded and inventory restored." },
      { status: 400 }
    );
  }
  if (order.inventoryRestoredAt) {
    return NextResponse.json(
      { error: "Items from this order have already been re-listed." },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.storeOrder.update({
      where: { id: order.id },
      data: { inventoryRestoredAt: new Date() },
    });
    for (const oi of order.items) {
      await tx.storeItem.update({
        where: { id: oi.storeItemId },
        data: { quantity: { increment: oi.quantity } },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
