import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { listAwaitingShipmentOrders } from "@/lib/channels/ebay/fulfillment-orders";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/** GET /api/channels/ebay/orders — minimal unpaid-to-ship eBay orders list. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) return NextResponse.json({ error: "eBay not connected" }, { status: 404 });

  try {
    const orders = await listAwaitingShipmentOrders(ctx.accessToken);
    return NextResponse.json({
      orders: orders.map((order) => ({
        orderId: order.orderId,
        buyerUsername: order.buyerUsername ?? null,
        creationDate: order.creationDate ?? null,
        orderFulfillmentStatus: order.orderFulfillmentStatus ?? null,
        lineItems: (order.lineItems ?? []).map((line) => ({
          lineItemId: line.lineItemId ?? null,
          sku: line.sku ?? null,
          title: line.title ?? null,
          quantity: line.quantity ?? 0,
        })),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 502 });
  }
}
