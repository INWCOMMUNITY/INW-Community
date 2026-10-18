export type StoreOrderRefundPhase = "initiated" | "complete" | null;

export const BUYER_REFUND_TIMING_NOTE =
  "Most card refunds take 5–10 business days to appear on your statement, depending on your bank.";

export const BUYER_CANCEL_CARD_HINT =
  "This will cancel your order and initiate a refund to your original payment method. Stripe’s non-refundable card processing fees are deducted from the refund (INW does not take a storefront sales commission and does not absorb those fees). Most card refunds take 5–10 business days to appear on your statement.";

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

export type BuyerCommerceStatusTone = "pending" | "approved" | "moving" | "complete" | "declined";

export type BuyerCommerceStatus = {
  title: string;
  detail: string;
  note?: string;
  tone: BuyerCommerceStatusTone;
  icon: "time-outline" | "card-outline" | "print-outline" | "checkmark-circle-outline" | "checkmark-done-outline" | "swap-horizontal-outline" | "cube-outline" | "close-circle-outline";
};

/** Title and short detail for a buyer refund or return. Keep in sync with apps/main buyer-commerce-status.ts. */
export function buyerCommerceStatus(order: {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
  refundRequestedAt?: string | null;
  refundReason?: string | null;
  storeReturn?: { status: string; declineReason?: string | null } | null;
  returnShipment?: { labelUrl?: string | null } | null;
}): BuyerCommerceStatus | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") {
    return { title: "Refund complete", detail: BUYER_REFUND_TIMING_NOTE, tone: "complete", icon: "checkmark-done-outline" };
  }
  if (phase === "initiated") {
    return { title: "Refund initiated", detail: BUYER_REFUND_TIMING_NOTE, tone: "moving", icon: "card-outline" };
  }

  const ret = order.storeReturn;
  if (ret?.status === "requested") {
    return { title: "Return requested", detail: "The seller will review.", tone: "pending", icon: "time-outline" };
  }
  if (ret?.status === "awaiting_return") {
    const hasLabel = Boolean(order.returnShipment?.labelUrl);
    return {
      title: "Return approved",
      detail: hasLabel ? "Print your return label." : "A return label is on the way.",
      tone: "approved",
      icon: hasLabel ? "print-outline" : "checkmark-circle-outline",
    };
  }
  if (ret?.status === "in_transit") {
    return { title: "Return in progress", detail: "On the way back to the seller.", tone: "moving", icon: "swap-horizontal-outline" };
  }
  if (ret?.status === "received") {
    return { title: "Return received", detail: "Your refund is processing.", tone: "moving", icon: "cube-outline" };
  }
  if (ret?.status === "refunded") {
    return { title: "Refund initiated", detail: BUYER_REFUND_TIMING_NOTE, tone: "moving", icon: "card-outline" };
  }
  if (ret?.status === "declined") {
    return {
      title: "Return declined",
      detail: ret.declineReason?.trim() || "The seller declined this request.",
      tone: "declined",
      icon: "close-circle-outline",
    };
  }
  if (ret?.status === "canceled") {
    return { title: "Return canceled", detail: "This return was canceled.", tone: "declined", icon: "close-circle-outline" };
  }
  if (order.refundRequestedAt) {
    return {
      title: "Refund requested",
      detail: "The seller will review.",
      note: order.refundReason?.trim() || undefined,
      tone: "pending",
      icon: "time-outline",
    };
  }
  return null;
}

export const BUYER_RETURN_SHIPPING_WARNING =
  "This seller charges return shipping. The Shippo return-label price will be deducted from your refund once the seller buys the label. The exact amount is set at that time.";

export const BUYER_REFUND_POLICY_POPUP_TITLE = "NWC Marketplace Refund Policy";

export const BUYER_REFUND_POLICY_POPUP_BODY =
  "NWC does not personally profit off of items sold in the storefront. Stripe’s credit card processing does not refund their portion, and therefore that processing fee will be eaten by the buyer on a refund request — rather than charging the seller for that fee twice.";

export const BUYER_REFUND_POLICY_CONTINUE_LABEL = "Understood";
export const BUYER_REFUND_POLICY_NEVERMIND_LABEL = "Nevermind.";

function nonRefundableStripeFeeCentsMobile(order: {
  totalCents: number;
  taxCents?: number | null;
}): number {
  const charge = Math.max(0, order.totalCents + (order.taxCents ?? 0));
  const processing = charge > 0 ? Math.floor(charge * 0.029) + 30 : 0;
  const taxProduct =
    (order.taxCents ?? 0) > 0 && charge > 0 ? Math.floor(charge * 0.005) : 0;
  return processing + taxProduct;
}

/** Fee line for the buyer policy popup. Mirrors main `nonRefundableStripeFeeCents`. */
export function formatBuyerRefundFeeDeductionLine(order: {
  totalCents: number;
  taxCents?: number | null;
}): string {
  const feeCents = nonRefundableStripeFeeCentsMobile(order);
  return `Fee deducted from your refund: $${(feeCents / 100).toFixed(2)}`;
}

export const SELLER_REFUND_POLICY_POPUP_TITLE = "NWC Marketplace Refund Policy";

export const SELLER_REFUND_POLICY_POPUP_BODY =
  "NWC does not personally profit off of items sold in the storefront. Stripe’s credit card processing does not refund their portion when you cancel and refund an order. The buyer is refunded in full, and that processing fee is absorbed on the seller side — rather than deducting it from the buyer.";

export function formatSellerRefundFeeAbsorptionLine(order: {
  totalCents: number;
  taxCents?: number | null;
}): string {
  const feeCents = nonRefundableStripeFeeCentsMobile(order);
  return `Stripe fee you absorb on this refund: $${(feeCents / 100).toFixed(2)}`;
}

export const NWC_MARKETPLACE_REFUND_POLICY_PRODUCT_TITLE = "NWC Marketplace Refund Policy";

export const NWC_MARKETPLACE_REFUND_POLICY_PRODUCT_TEXT =
  "NWC does not personally profit off of items sold in the storefront. Stripe does not return its card processing fees when a payment is refunded.\n\n" +
  "If you (the buyer) cancel or request a refund/return, Stripe’s non-refundable processing fee is deducted from your refund. If the seller cancels and refunds the order, you are refunded in full and the seller absorbs that fee.\n\n" +
  "Typical Stripe fees are about 2.9% + $0.30 of the original charge, plus Stripe Tax’s 0.5% product fee when sales tax was collected. Return shipping may also be deducted when the seller’s return policy charges it.";

/** Matches server `buyerFulfillmentHasStarted`: a label or completed handoff counts as shipped. */
export function buyerFulfillmentHasStarted(order: {
  status: string;
  shipment?: {
    createdAt?: string | null;
    trackingNumber?: string | null;
    trackingStatus?: string | null;
  } | null;
  pickupSellerConfirmedAt?: string | null;
  pickupBuyerConfirmedAt?: string | null;
  deliveryConfirmedAt?: string | null;
  deliveryBuyerConfirmedAt?: string | null;
}): boolean {
  if (order.status === "shipped" || order.status === "delivered") return true;
  if (order.status !== "paid") return false;
  if (order.shipment) return true;
  if (order.pickupSellerConfirmedAt && order.pickupBuyerConfirmedAt) return true;
  if (order.deliveryConfirmedAt && order.deliveryBuyerConfirmedAt) return true;
  return false;
}

export function canCancelMobileBuyerOrder(
  order: Parameters<typeof buyerFulfillmentHasStarted>[0]
): boolean {
  return order.status === "paid" && !buyerFulfillmentHasStarted(order);
}

export function canRequestMobileBuyerRefund(order: {
  status: string;
  isCashOrder?: boolean;
  sellerAcceptsReturns?: boolean;
  returnWindowEndsAt?: string | null;
  refundRequestedAt?: string | null;
  storeReturn?: { status: string } | null;
  shipment?: {
    createdAt?: string | null;
    trackingNumber?: string | null;
    trackingStatus?: string | null;
  } | null;
  pickupSellerConfirmedAt?: string | null;
  pickupBuyerConfirmedAt?: string | null;
  deliveryConfirmedAt?: string | null;
  deliveryBuyerConfirmedAt?: string | null;
}): boolean {
  if (order.sellerAcceptsReturns === false) return false;
  if (order.isCashOrder) return false;
  if (!buyerFulfillmentHasStarted(order)) return false;
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
