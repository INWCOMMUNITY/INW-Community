import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { syncInventoryToChannelsAfterSale } from "@/lib/channels/sync-inventory";
import { refundPaidStorefrontOrder } from "@/lib/stripe/refund-store-order";

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
 * Card: reverse Connect transfer, refund platform PI (incl. tax), restock.
 * Cash: cancel only, restock.
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
    include: { items: true },
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

  const isCashOrder = !order.stripePaymentIntentId;

  if (isCashOrder) {
    await prisma.$transaction(async (tx) => {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: {
          status: "canceled",
          cancelReason: cancelReason ?? undefined,
          cancelNote: note ?? undefined,
          inventoryRestoredAt: new Date(),
        },
      });
      await restockOrderLinesAfterReturn(tx, order.items);
    });
    await Promise.all(order.items.map((oi) => syncInventoryToChannelsAfterSale(oi.storeItemId)));
    return NextResponse.json({ ok: true, refunded: false });
  }

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
    reason: cancelReason ?? "Buyer canceled",
    note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, refunded: true });
}
