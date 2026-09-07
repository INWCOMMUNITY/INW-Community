export type StoreOrderRefundPhase = "initiated" | "complete" | null;

export const BUYER_REFUND_TIMING_NOTE =
  "Most card refunds take 5–10 business days to appear on your statement, depending on your bank.";

export const BUYER_CANCEL_CARD_HINT =
  "This will cancel your order and initiate a refund to your original payment method. Most card refunds take 5–10 business days to appear on your statement.";

export const BUYER_PENDING_REFUND_COPY = `Refund Initiated. ${BUYER_REFUND_TIMING_NOTE}`;

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
  refunded: "Refund Initiated",
};

export function getOrderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export function storeOrderRefundPhase(order: {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
}): StoreOrderRefundPhase {
  if (order.isCashOrder) return null;
  if (order.refundCompletedAt) return "complete";
  if (order.refundInitiatedAt || order.status === "refunded") return "initiated";
  return null;
}

export function getStoreOrderStatusLabel(order: {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
}): string {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") return "Refund Complete";
  if (phase === "initiated") return "Refund Initiated";
  return getOrderStatusLabel(order.status);
}

export function getBuyerOrderStatusLabel(
  status: string,
  order?: { isCashOrder?: boolean; refundInitiatedAt?: string | null; refundCompletedAt?: string | null }
): string {
  if (order) return getStoreOrderStatusLabel({ status, ...order });
  if (status === "refunded") return "Refund Initiated";
  return getOrderStatusLabel(status);
}

export function buyerRefundStatusNote(order: {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
}): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") return `Refund Complete. ${BUYER_REFUND_TIMING_NOTE}`;
  if (phase === "initiated") return `Refund Initiated. ${BUYER_REFUND_TIMING_NOTE}`;
  return null;
}

export function buyerHasPendingRefund(order: {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
}): boolean {
  return storeOrderRefundPhase(order) != null;
}

export const BUYER_RETURN_SHIPPING_WARNING =
  "This seller charges return shipping. The Shippo return-label price will be deducted from your refund once the seller buys the label. The exact amount is set at that time.";

export function canRequestMobileBuyerRefund(order: {
  status: string;
  isCashOrder?: boolean;
  sellerAcceptsReturns?: boolean;
  returnWindowEndsAt?: string | null;
  refundRequestedAt?: string | null;
  storeReturn?: { status: string } | null;
}): boolean {
  if (order.sellerAcceptsReturns === false) return false;
  if (order.isCashOrder) return false;
  if (order.status !== "shipped" && order.status !== "delivered") return false;
  if (
    order.storeReturn &&
    ["requested", "awaiting_return", "in_transit", "received", "refunded"].includes(order.storeReturn.status)
  ) {
    return false;
  }
  if (!order.storeReturn && order.refundRequestedAt) return false;
  if (order.returnWindowEndsAt) {
    const end = new Date(order.returnWindowEndsAt);
    if (!Number.isNaN(end.getTime()) && Date.now() > end.getTime()) return false;
  }
  return true;
}

export function sellerRefundStatusNote(order: {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
}): string | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") return "Refund Complete. Stripe has processed the buyer’s refund.";
  if (phase === "initiated") return `Refund Initiated. ${BUYER_REFUND_TIMING_NOTE}`;
  return null;
}
