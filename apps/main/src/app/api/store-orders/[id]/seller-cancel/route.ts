import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { syncInventoryToChannelsAfterSale } from "@/lib/channels/sync-inventory";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";
import { refundPaidStorefrontOrder } from "@/lib/stripe/refund-store-order";

export const dynamic = "force-dynamic";

/**
 * Seller cancels a paid to-ship order before it is marked shipped.
 * Cash / reward: cancel + inventory restore.
 * Card: Stripe refund + seller balance deduction + inventory restore.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(_req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: { items: true, shipment: { select: { id: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!orderHasShippedLine(order.items)) {
    return NextResponse.json(
      { error: "This order has no ship items. Cancel it from the matching fulfillment tab." },
      { status: 400 }
    );
  }
  if (order.shipment || order.shippedWithOrderId) {
    return NextResponse.json(
      { error: "This order already has a shipment. Contact support if you need to cancel it." },
      { status: 400 }
    );
  }
  if (order.status !== "paid") {
    return NextResponse.json(
      { error: "Only paid orders waiting to ship can be canceled here." },
      { status: 400 }
    );
  }

  const cancelReason = "Seller canceled & refunded";
  const isCashOrder = !order.stripePaymentIntentId;

  if (isCashOrder) {
    await prisma.$transaction(async (tx) => {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: {
          status: "canceled",
          cancelReason,
          inventoryRestoredAt: new Date(),
        },
      });
      await restockOrderLinesAfterReturn(tx, order.items);
    });
    await Promise.all(order.items.map((oi) => syncInventoryToChannelsAfterSale(oi.storeItemId)));
  } else {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey?.startsWith("sk_")) {
      return NextResponse.json(
        { error: "Refunds are not configured. Please contact support." },
        { status: 503 }
      );
    }
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2024-11-20.acacia" as "2023-10-16",
    });
    const result = await refundPaidStorefrontOrder({
      stripe,
      order,
      reason: cancelReason,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
  }

  const { sendPushNotification } = await import("@/lib/send-push-notification");
  sendPushNotification(order.buyerId, {
    title: "Order update",
    body: isCashOrder
      ? "The seller canceled your storefront order. Check My orders for details."
      : "The seller canceled your storefront order and issued a refund. Check My orders for details.",
    data: { screen: "my-orders", orderId: order.id },
    category: "commerce",
  }).catch(() => {});

  return NextResponse.json({ ok: true, refunded: !isCashOrder });
}
