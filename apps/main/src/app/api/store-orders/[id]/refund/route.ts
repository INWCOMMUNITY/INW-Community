import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hasOptionQuantities, incrementOptionQuantity } from "@/lib/store-item-variants";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

const PLATFORM_FEE_PERCENT = 0.05;
const PLATFORM_FEE_MIN_CENTS = 50;

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: { items: true, seller: { select: { stripeConnectAccountId: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status === "refunded") {
    return NextResponse.json({ error: "Order already refunded" }, { status: 400 });
  }
  if (!order.stripePaymentIntentId) {
    return NextResponse.json({ error: "Order has no payment to refund" }, { status: 400 });
  }

  const totalCents = order.totalCents;
  const connectAccountId = order.seller?.stripeConnectAccountId?.trim() || null;

  if (connectAccountId) {
    try {
      await stripe.refunds.create(
        {
          payment_intent: order.stripePaymentIntentId,
          amount: totalCents,
          reason: "requested_by_customer",
        },
        { stripeAccount: connectAccountId }
      );
      await prisma.$transaction(async (tx) => {
        await tx.storeOrder.update({
          where: { id: order.id },
          data: { status: "refunded" },
        });
        const storeItemsRefund = await tx.storeItem.findMany({
          where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
        });
        const storeItemMapRefund = new Map(storeItemsRefund.map((s) => [s.id, s]));
        for (const oi of order.items) {
          const storeItem = storeItemMapRefund.get(oi.storeItemId);
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
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Refund failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const platformFeeCents = Math.max(
    PLATFORM_FEE_MIN_CENTS,
    Math.floor(totalCents * PLATFORM_FEE_PERCENT)
  );
  const sellerDeductionCents = totalCents - platformFeeCents;

  const balance = await prisma.sellerBalance.findUnique({
    where: { memberId: userId },
  });
  const availableCents = balance?.balanceCents ?? 0;

  if (availableCents < sellerDeductionCents) {
    return NextResponse.json(
      {
        error: "Insufficient funds",
        needsCents: sellerDeductionCents - availableCents,
        message: `Your balance is $${(availableCents / 100).toFixed(2)}. Refund requires $${(sellerDeductionCents / 100).toFixed(2)}. Add funds or use a payment method.`,
      },
      { status: 400 }
    );
  }

  try {
    await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      amount: totalCents,
      reason: "requested_by_customer",
    });

    await prisma.$transaction(async (tx) => {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: { status: "refunded" },
      });
      await tx.sellerBalance.upsert({
        where: { memberId: userId },
        create: {
          memberId: userId,
          balanceCents: -sellerDeductionCents,
          totalEarnedCents: 0,
          totalPaidOutCents: 0,
        },
        update: { balanceCents: { decrement: sellerDeductionCents } },
      });
      await tx.sellerBalanceTransaction.create({
        data: {
          memberId: userId,
          type: "return",
          amountCents: -sellerDeductionCents,
          orderId: order.id,
          description: `Refund: Order #${order.id.slice(-6)} - $${(totalCents / 100).toFixed(2)}`,
        },
      });
      const storeItemsRefundStripe = await tx.storeItem.findMany({
        where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
      });
      const storeItemMapRefundStripe = new Map(storeItemsRefundStripe.map((s) => [s.id, s]));
      for (const oi of order.items) {
        const storeItem = storeItemMapRefundStripe.get(oi.storeItemId);
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

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refund failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
