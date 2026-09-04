/** Storefront return status machine and refund-amount helpers. */

export const STORE_RETURN_STATUSES = [
  "requested",
  "awaiting_return",
  "in_transit",
  "received",
  "refunded",
  "declined",
  "canceled",
] as const;

export type StoreReturnStatus = (typeof STORE_RETURN_STATUSES)[number];

export const ACTIVE_STORE_RETURN_STATUSES: readonly StoreReturnStatus[] = [
  "requested",
  "awaiting_return",
  "in_transit",
  "received",
];

export const AWAITING_RETURN_STATUSES: readonly StoreReturnStatus[] = [
  "awaiting_return",
  "in_transit",
];

export function isActiveStoreReturnStatus(status: string | null | undefined): boolean {
  return ACTIVE_STORE_RETURN_STATUSES.includes(status as StoreReturnStatus);
}

export function isAwaitingReturnStatus(status: string | null | undefined): boolean {
  return AWAITING_RETURN_STATUSES.includes(status as StoreReturnStatus);
}

export function buyerCanRequestRefund(order: {
  status: string;
  isCashOrder?: boolean;
  stripePaymentIntentId?: string | null;
  storeReturn?: { status: string } | null;
  refundRequestedAt?: string | Date | null;
}): boolean {
  if (order.isCashOrder) return false;
  if (order.stripePaymentIntentId === null) return false;
  if (order.status !== "shipped" && order.status !== "delivered") return false;
  if (order.storeReturn && isActiveStoreReturnStatus(order.storeReturn.status)) return false;
  if (order.storeReturn?.status === "refunded") return false;
  if (!order.storeReturn && order.refundRequestedAt) return false;
  return true;
}

export function fullRefundChargeCents(order: {
  totalCents: number;
  taxCents?: number | null;
}): number {
  return Math.max(0, order.totalCents + (order.taxCents ?? 0));
}

/**
 * Buyer refund when a return completes.
 * Deducts the return-label cost only when chargeReturnShipping was snapshotted on.
 */
export function returnRefundAmountCents(args: {
  totalCents: number;
  taxCents?: number | null;
  chargeReturnShipping: boolean;
  returnLabelCostCents?: number | null;
}): number {
  const full = fullRefundChargeCents(args);
  if (!args.chargeReturnShipping) return full;
  return Math.max(0, full - Math.max(0, args.returnLabelCostCents ?? 0));
}

/**
 * Connect transfer reversal so the seller keeps the return-label amount
 * when chargeReturnShipping is on (they already paid Shippo).
 */
export function sellerTransferReversalCents(args: {
  originalTransferCents: number;
  chargeReturnShipping: boolean;
  returnLabelCostCents?: number | null;
}): number {
  const original = Math.max(0, args.originalTransferCents);
  if (!args.chargeReturnShipping) return original;
  return Math.max(0, original - Math.max(0, args.returnLabelCostCents ?? 0));
}

export function sellerLedgerDebitForReturnCents(args: {
  originalDebitCents: number;
  chargeReturnShipping: boolean;
  returnLabelCostCents?: number | null;
}): number {
  return sellerTransferReversalCents({
    originalTransferCents: args.originalDebitCents,
    chargeReturnShipping: args.chargeReturnShipping,
    returnLabelCostCents: args.returnLabelCostCents,
  });
}

export function storeReturnBuyerLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "requested") return "Return requested. Waiting for the seller to review.";
  if (status === "awaiting_return") return "Return approved. Ship the item back to the seller.";
  if (status === "in_transit") return "Return in transit to the seller.";
  if (status === "received") return "Seller received your return. Refund is being processed.";
  if (status === "refunded") return "Refund issued.";
  if (status === "declined") return "The seller declined this return request.";
  if (status === "canceled") return "This return was canceled.";
  return null;
}
