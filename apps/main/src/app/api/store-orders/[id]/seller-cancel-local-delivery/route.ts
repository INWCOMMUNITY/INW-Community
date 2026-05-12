import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hasOptionQuantities, incrementOptionQuantity } from "@/lib/store-item-variants";
import { deductPoints } from "@/lib/award-points";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";

export const dynamic = "force-dynamic";

const PLATFORM_FEE_PERCENT = 0.05;
const PLATFORM_FEE_MIN_CENTS = 50;

/**
 * Seller cancels a local-delivery order before they mark it delivered (handoff not claimed yet).
 * Mirrors buyer cancel economics: cash → canceled + inventory restore; card → Stripe refund + seller balance deduction + inventory restore.
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
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.localDeliveryDetails == null || typeof order.localDeliveryDetails !== "object") {
    return NextResponse.json({ error: "This order is not a local delivery order." }, { status: 400 });
  }
  const hasLocalLine = order.items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");
  if (!hasLocalLine) {
    return NextResponse.json({ error: "No local delivery line items on this order." }, { status: 400 });
  }
  if (orderHasShippedLine(order.items)) {
    return NextResponse.json(
      {
        error:
          "This order includes mail-shipping items. Canceling from deliveries is only for local-delivery-only orders. Use Orders or contact support if you need help.",
      },
      { status: 400 }
    );
  }
  if (order.deliveryConfirmedAt) {
    return NextResponse.json(
      { error: "You already marked this order delivered. The buyer may have been notified — contact support to resolve issues." },
      { status: 400 }
    );
  }
  if (order.status !== "paid") {
    return NextResponse.json(
      { error: "Only paid orders can be canceled here. If this order is unpaid or already completed, use the appropriate flow." },
      { status: 400 }
    );
  }

  const cancelReason = "Seller canceled delivery";
  const isCashOrder = !order.stripePaymentIntentId;

  if (isCashOrder) {
    await prisma.$transaction(async (tx) => {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: { status: "canceled", cancelReason, cancelNote: undefined },
      });
      const storeItemsCancel = await tx.storeItem.findMany({
        where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
      });
      const storeItemMapCancel = new Map(storeItemsCancel.map((s) => [s.id, s]));
      for (const oi of order.items) {
        const storeItem = storeItemMapCancel.get(oi.storeItemId);
        if (storeItem && hasOptionQuantities(storeItem.variants) && oi.variant) {
          const res = incrementOptionQuantity(storeItem.variants, oi.variant, oi.quantity);
          if (res) {
            await tx.storeItem.update({
              where: { id: oi.storeItemId },
              data: { variants: res.variants as object, quantity: { increment: res.quantityDelta } },
            });
          } else {
            await tx.storeItem.update({
              where: { id: oi.storeItemId },
              data: { quantity: { increment: oi.quantity } },
            });
          }
        } else {
          await tx.storeItem.update({
            where: { id: oi.storeItemId },
            data: { quantity: { increment: oi.quantity } },
          });
        }
      }
    });
    if (order.pointsAwarded > 0) {
      await deductPoints(order.buyerId, order.pointsAwarded);
    }
  } else {
    const totalCents = order.totalCents;
    const platformFeeCents = Math.max(
      PLATFORM_FEE_MIN_CENTS,
      Math.floor(totalCents * PLATFORM_FEE_PERCENT)
    );
    const sellerDeductionCents = totalCents - platformFeeCents;

    const balance = await prisma.sellerBalance.findUnique({
      where: { memberId: order.sellerId },
    });
    const availableCents = balance?.balanceCents ?? 0;
    if (availableCents < sellerDeductionCents) {
      return NextResponse.json(
        {
          error:
            "Your seller balance is too low to refund this card order. Ask the buyer to request a refund from their order screen, or contact support.",
        },
        { status: 400 }
      );
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

    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId!,
        amount: totalCents,
        reason: "requested_by_customer",
      });

      await prisma.$transaction(async (tx) => {
        await tx.storeOrder.update({
          where: { id: order.id },
          data: { status: "refunded", cancelReason, cancelNote: undefined },
        });
        await tx.sellerBalance.upsert({
          where: { memberId: order.sellerId },
          create: {
            memberId: order.sellerId,
            balanceCents: -sellerDeductionCents,
            totalEarnedCents: 0,
            totalPaidOutCents: 0,
          },
          update: { balanceCents: { decrement: sellerDeductionCents } },
        });
        await tx.sellerBalanceTransaction.create({
          data: {
            memberId: order.sellerId,
            type: "return",
            amountCents: -sellerDeductionCents,
            orderId: order.id,
            description: `Seller canceled delivery: Order #${order.id.slice(-6)} - $${(totalCents / 100).toFixed(2)}`,
          },
        });
        const storeItemsCancel = await tx.storeItem.findMany({
          where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
        });
        const storeItemMapCancel = new Map(storeItemsCancel.map((s) => [s.id, s]));
        for (const oi of order.items) {
          const storeItem = storeItemMapCancel.get(oi.storeItemId);
          if (storeItem && hasOptionQuantities(storeItem.variants) && oi.variant) {
            const res = incrementOptionQuantity(storeItem.variants, oi.variant, oi.quantity);
            if (res) {
              await tx.storeItem.update({
                where: { id: oi.storeItemId },
                data: { variants: res.variants as object, quantity: { increment: res.quantityDelta } },
              });
            } else {
              await tx.storeItem.update({
                where: { id: oi.storeItemId },
                data: { quantity: { increment: oi.quantity } },
              });
            }
          } else {
            await tx.storeItem.update({
              where: { id: oi.storeItemId },
              data: { quantity: { increment: oi.quantity } },
            });
          }
        }
      });

      if (order.pointsAwarded > 0) {
        await deductPoints(order.buyerId, order.pointsAwarded);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cancel/refund failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const { sendPushNotification } = await import("@/lib/send-push-notification");
  sendPushNotification(order.buyerId, {
    title: "Order update",
    body: "The seller canceled local delivery for your storefront order. Check My orders for details.",
    data: { screen: "my-orders", orderId: order.id },
    category: "commerce",
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
