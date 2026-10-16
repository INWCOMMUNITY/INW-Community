import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { refundPaidStorefrontOrder } from "@/lib/stripe/refund-store-order";
import { notifySellerOrderCanceled } from "@/lib/store-return-notify";
import { gateInteractiveOrFoundationWriter } from "@/lib/commerce-foundation-cutover-http";
import { tryCreateMarketplaceStripe } from "@/lib/stripe-clients";
import { buyerFulfillmentHasStarted } from "@/lib/store-return";
import { pickCurrentOutboundShipment } from "@/lib/store-order-shipments";

const CANCEL_REASONS = [
  "Changed my mind",
  "Didn't mean to order",
  "Order Arrived Damaged",
  "Wrong Item Delivered",
  "Other",
] as const;

export const dynamic = "force-dynamic";

/**
 * Buyer cancels an order before it is shipped.
 * Card: reverse Connect transfer, refund platform PI (incl. tax). Stock stays down until the seller chooses Return.
 * Cash: cancel only. Stock stays down until the seller chooses Return.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await gateInteractiveOrFoundationWriter();
  if (blocked) return blocked;

  let body: { reason?: string; otherReason?: string; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    // optional body
  }
  const reasonVal = typeof body.reason === "string" ? body.reason : null;
  const otherReason = typeof body.otherReason === "string" ? body.otherReason.trim() : null;
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  const cancelReason =
    reasonVal && CANCEL_REASONS.includes(reasonVal as (typeof CANCEL_REASONS)[number])
      ? reasonVal === "Other" && otherReason
        ? `Other: ${otherReason}`
        : reasonVal === "Other"
          ? "Other"
          : reasonVal
      : null;

  const order = await prisma.storeOrder.findFirst({
    where: { id: params.id, buyerId: session.user.id },
    include: {
      buyer: { select: { firstName: true, lastName: true } },
      items: true,
      shipments: {
        select: {
          createdAt: true,
          kind: true,
          supersededAt: true,
          trackingNumber: true,
          trackingStatus: true,
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "paid") {
    return NextResponse.json(
      { error: "Order can only be canceled before it is shipped." },
      { status: 400 }
    );
  }
  if (
    buyerFulfillmentHasStarted({
      status: order.status,
      shipment: pickCurrentOutboundShipment(order.shipments),
      pickupSellerConfirmedAt: order.pickupSellerConfirmedAt,
      pickupBuyerConfirmedAt: order.pickupBuyerConfirmedAt,
      deliveryConfirmedAt: order.deliveryConfirmedAt,
      deliveryBuyerConfirmedAt: order.deliveryBuyerConfirmedAt,
    })
  ) {
    return NextResponse.json(
      { error: "This order has shipped. Request a refund instead of canceling." },
      { status: 400 }
    );
  }

  const isCashOrder = !order.stripePaymentIntentId;

  if (isCashOrder) {
    await prisma.$transaction(async (tx) => {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: {
          status: "canceled",
          cancelReason: cancelReason ?? undefined,
          cancelNote: note ?? undefined,
        },
      });
    });
    notifySellerOrderCanceled(order.sellerId, order.id, buyerDisplayName(order));
    return NextResponse.json({ ok: true, refunded: false });
  }

  const stripe = tryCreateMarketplaceStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Refunds are not configured. Please contact support." },
      { status: 503 }
    );
  }

  const result = await refundPaidStorefrontOrder({
    stripe,
    order,
    reason: cancelReason ?? "Buyer canceled",
    restock: false,
    note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  notifySellerOrderCanceled(order.sellerId, order.id, buyerDisplayName(order));
  return NextResponse.json({ ok: true, refunded: true });
}

function buyerDisplayName(order: {
  buyer?: { firstName?: string | null; lastName?: string | null } | null;
}): string {
  const name = `${order.buyer?.firstName ?? ""} ${order.buyer?.lastName ?? ""}`.trim();
  return name || "A buyer";
}
