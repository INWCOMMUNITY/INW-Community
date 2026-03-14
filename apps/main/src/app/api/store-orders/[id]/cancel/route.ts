import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hasOptionQuantities, incrementOptionQuantity } from "@/lib/store-item-variants";
import { deductPoints } from "@/lib/award-points";

const CANCEL_REASONS = [
  "Changed my mind",
  "Didn't mean to order",
  "Order Arrived Damaged",
  "Wrong Item Delivered",
  "Other",
] as const;

const PLATFORM_FEE_PERCENT = 0.05;
const PLATFORM_FEE_MIN_CENTS = 50;

export const dynamic = "force-dynamic";

/**
 * Buyer cancels an order before it is shipped.
 * - Card orders: refund from seller's funds (Stripe refund + deduct seller balance), restore inventory.
 * - Cash orders: cancel only (no refund), restore inventory.
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
        data: { status: "canceled", cancelReason: cancelReason ?? undefined, cancelNote: note ?? undefined },
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
    return NextResponse.json({ ok: true, refunded: false });
  }

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
        error: "Seller has insufficient funds to process this refund. Please contact the seller or request a refund instead.",
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
        data: { status: "refunded", cancelReason: cancelReason ?? undefined, cancelNote: note ?? undefined },
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
          description: `Buyer canceled: Order #${order.id.slice(-6)} - $${(totalCents / 100).toFixed(2)}`,
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

    return NextResponse.json({ ok: true, refunded: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cancel/refund failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
