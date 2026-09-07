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
  if (phase === "complete") return "Refund Complete";
  if (phase === "initiated") return "Refund Initiated";
  return null;
}

/** True when we should ask Stripe whether an in-progress refund has succeeded. */
export function orderNeedsRefundCompletionSync(order: {
  status?: string;
  stripePaymentIntentId?: string | null;
  stripeRefundId?: string | null;
  refundInitiatedAt?: Date | string | null;
  refundCompletedAt?: Date | string | null;
}): boolean {
  if (order.refundCompletedAt || !order.stripePaymentIntentId) return false;
  return (
    order.status === "refunded" || Boolean(order.refundInitiatedAt) || Boolean(order.stripeRefundId)
  );
}

export function buyerRefundStatusNote(order: StoreOrderRefundFields): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") {
    return `Refund Complete. ${BUYER_REFUND_TIMING_NOTE}`;
  }
  if (phase === "initiated") {
    return `Refund Initiated. ${BUYER_REFUND_TIMING_NOTE}`;
  }
  return null;
}

export function sellerRefundStatusNote(order: StoreOrderRefundFields): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") {
    return "Refund Complete. Stripe has processed the buyer’s refund.";
  }
  if (phase === "initiated") {
    return `Refund Initiated. ${BUYER_REFUND_TIMING_NOTE}`;
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

export function latestRefundFromCharge(charge: {
  refunds?: { data?: Array<{ id?: string; status?: string | null; created?: number }> } | null;
}): { id?: string; status?: string | null; created?: number } | null {
  const list = charge.refunds?.data;
  if (!list?.length) return null;
  return list.find((r) => r.status === "succeeded") ?? list[0] ?? null;
}
