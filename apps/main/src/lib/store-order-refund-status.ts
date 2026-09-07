import Stripe from "stripe";
import { prisma } from "database";

export type StoreOrderRefundPhase = "initiated" | "complete" | null;

export const BUYER_REFUND_TIMING_NOTE =
  "Most card refunds take 5–10 business days to appear on your statement, depending on your bank.";

export const BUYER_CANCEL_CARD_HINT =
  "This will cancel your order and initiate a refund to your original payment method. Most card refunds take 5–10 business days to appear on your statement.";

export type StoreOrderRefundFields = {
  status: string;
  isCashOrder?: boolean;
  stripePaymentIntentId?: string | null;
  refundInitiatedAt?: string | Date | null;
  refundCompletedAt?: string | Date | null;
};

export function storeOrderRefundPhase(order: StoreOrderRefundFields): StoreOrderRefundPhase {
  if (order.isCashOrder) return null;
  if (order.refundCompletedAt) return "complete";
  if (order.refundInitiatedAt || order.status === "refunded") return "initiated";
  return null;
}

export function storeOrderRefundStatusLabel(order: StoreOrderRefundFields): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") return "Refund complete";
  if (phase === "initiated") return "Refund initiated";
  return null;
}

export function buyerRefundStatusNote(order: StoreOrderRefundFields): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") {
    return `Refund complete. ${BUYER_REFUND_TIMING_NOTE}`;
  }
  if (phase === "initiated") {
    return `Refund initiated. ${BUYER_REFUND_TIMING_NOTE}`;
  }
  return null;
}

export function sellerRefundStatusNote(order: StoreOrderRefundFields): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") {
    return "Refund complete. Stripe has processed the buyer’s refund.";
  }
  if (phase === "initiated") {
    return `Refund initiated. ${BUYER_REFUND_TIMING_NOTE}`;
  }
  return null;
}

export function timestampsFromStripeRefund(refund: {
  id?: string;
  status?: string | null;
  created?: number;
}): {
  stripeRefundId?: string;
  refundInitiatedAt: Date;
  refundCompletedAt: Date | null;
} {
  const initiated = refund.created ? new Date(refund.created * 1000) : new Date();
  return {
    stripeRefundId: refund.id,
    refundInitiatedAt: initiated,
    refundCompletedAt: refund.status === "succeeded" ? new Date() : null,
  };
}

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
    refundCompletedAt?: Date | string | null;
  }
): Promise<void> {
  if (!order.stripePaymentIntentId || order.refundCompletedAt) return;
  const refunds = await stripe.refunds.list({
    payment_intent: order.stripePaymentIntentId,
    limit: 5,
  });
  const refund = refunds.data[0];
  if (!refund) return;
  await persistStoreOrderRefundFromStripe(order.id, refund);
}

export function latestRefundFromCharge(charge: {
  refunds?: { data?: Array<{ id?: string; status?: string | null; created?: number }> } | null;
}): { id?: string; status?: string | null; created?: number } | null {
  const list = charge.refunds?.data;
  if (!list?.length) return null;
  return list[0] ?? null;
}
