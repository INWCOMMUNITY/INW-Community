import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { gateInteractiveOrFoundationWriter } from "@/lib/commerce-foundation-cutover-http";

export const dynamic = "force-dynamic";

/**
 * Seller chooses whether a canceled or returned line goes back on the listing.
 * Return puts that line's quantity back. Don't Return leaves it off so it cannot sell again
 * while the item is still with the buyer.
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
  const blocked = await gateInteractiveOrFoundationWriter();
  if (blocked) return blocked;

  const { id } = await params;
  let body: { orderItemId?: string; decision?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Choose Return or Don't Return." }, { status: 400 });
  }
  const orderItemId = typeof body.orderItemId === "string" ? body.orderItemId : "";
  const decision = body.decision === "return" || body.decision === "withhold" ? body.decision : null;
  if (!orderItemId || !decision) {
    return NextResponse.json({ error: "Choose Return or Don't Return." }, { status: 400 });
  }

  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    select: {
      id: true,
      status: true,
      inventoryRestoredAt: true,
      storeReturns: { select: { id: true }, take: 1 },
      items: { where: { id: orderItemId }, select: { id: true } },
    },
  });
  if (!order || order.items.length === 0) {
    return NextResponse.json({ error: "Order item not found" }, { status: 404 });
  }
  const canceled =
    order.status === "canceled" || order.status === "cancelled" || order.status === "refunded";
  if (!canceled && order.storeReturns.length === 0) {
    return NextResponse.json(
      { error: "Stock can be returned after the order is canceled or a return is open." },
      { status: 400 }
    );
  }
  if (order.inventoryRestoredAt) {
    return NextResponse.json({ error: "Stock was already returned for this order." }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.storeOrder.findUnique({
        where: { id: order.id },
        select: { inventoryRestoredAt: true },
      });
      if (locked?.inventoryRestoredAt) {
        throw new Error("ALREADY_RESTORED");
      }
      const claimed = await tx.orderItem.updateMany({
        where: { id: orderItemId, orderId: order.id, stockReturnDecision: null },
        data: { stockReturnDecision: decision === "return" ? "returned" : "withheld" },
      });
      if (claimed.count !== 1) {
        throw new Error("ALREADY_DECIDED");
      }
      if (decision === "return") {
        const line = await tx.orderItem.findUnique({
          where: { id: orderItemId },
          select: {
            id: true,
            storeItemId: true,
            quantity: true,
            variant: true,
            variantId: true,
          },
        });
        if (!line) throw new Error("MISSING_LINE");
        await restockOrderLinesAfterReturn(
          tx,
          [line],
          "UNDO_CONSUMPTION",
          `seller-stock-return:${line.id}`
        );
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "ALREADY_RESTORED") {
      return NextResponse.json({ error: "Stock was already returned for this order." }, { status: 409 });
    }
    if (message === "ALREADY_DECIDED") {
      return NextResponse.json({ error: "That item already has a stock decision." }, { status: 409 });
    }
    const detail = e instanceof Error ? e.message : "Could not update stock.";
    return NextResponse.json({ error: detail || "Could not update stock." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, decision });
}
