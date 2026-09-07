import Stripe from "stripe";
import { prisma } from "database";
import {
  orderNeedsRefundCompletionSync,
  timestampsFromStripeRefund,
} from "@/lib/store-order-refund-status";

export async function persistStoreOrderRefundFromStripe(
  orderId: string,
  refund: { id?: string; status?: string | null; created?: number }
): Promise<void> {
  const existing = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    select: { refundInitiatedAt: true, refundCompletedAt: true, stripeRefundId: true },
  });
  if (!existing) return;
  const next = timestampsFromStripeRefund(refund);
  await prisma.storeOrder.update({
    where: { id: orderId },
    data: {
      stripeRefundId: next.stripeRefundId ?? existing.stripeRefundId,
      refundInitiatedAt: existing.refundInitiatedAt ?? next.refundInitiatedAt,
      ...(existing.refundCompletedAt
        ? {}
        : next.refundCompletedAt
          ? { refundCompletedAt: next.refundCompletedAt }
          : {}),
    },
  });
}

export async function syncStoreOrderRefundFromStripe(
  stripe: Stripe,
  order: {
    id: string;
    stripePaymentIntentId?: string | null;
    stripeRefundId?: string | null;
    refundCompletedAt?: Date | string | null;
  }
): Promise<void> {
  if (!order.stripePaymentIntentId || order.refundCompletedAt) return;

  let refund: { id?: string; status?: string | null; created?: number } | null = null;
  if (order.stripeRefundId) {
    try {
      refund = await stripe.refunds.retrieve(order.stripeRefundId);
    } catch {
      refund = null;
    }
  }
  if (!refund || refund.status !== "succeeded") {
    const refunds = await stripe.refunds.list({
      payment_intent: order.stripePaymentIntentId,
      limit: 5,
    });
    refund = refunds.data.find((r) => r.status === "succeeded") ?? refunds.data[0] ?? refund;
  }
  if (!refund) return;
  await persistStoreOrderRefundFromStripe(order.id, refund);
}

export async function applyStripeRefundCompletionToOrders<
  T extends {
    id: string;
    status: string;
    stripePaymentIntentId?: string | null;
    stripeRefundId?: string | null;
    refundInitiatedAt?: Date | string | null;
    refundCompletedAt?: Date | string | null;
  },
>(orders: T[]): Promise<T[]> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_")) return orders;
  const pending = orders.filter(orderNeedsRefundCompletionSync).slice(0, 15);
  if (pending.length === 0) return orders;
  try {
    const stripe = new Stripe(key, {
      apiVersion: "2024-11-20.acacia" as "2023-10-16",
    });
    await Promise.all(pending.map((o) => syncStoreOrderRefundFromStripe(stripe, o).catch(() => undefined)));
    const refreshed = await prisma.storeOrder.findMany({
      where: { id: { in: pending.map((o) => o.id) } },
      select: { id: true, refundInitiatedAt: true, refundCompletedAt: true },
    });
    const byId = new Map(refreshed.map((r) => [r.id, r]));
    for (const o of orders) {
      const r = byId.get(o.id);
      if (r) {
        o.refundInitiatedAt = r.refundInitiatedAt;
        o.refundCompletedAt = r.refundCompletedAt;
      }
    }
  } catch {
    // List still works if Stripe is unavailable.
  }
  return orders;
}
