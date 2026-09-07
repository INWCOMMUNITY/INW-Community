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

export const DEFAULT_ACCEPT_RETURNS_DAYS = 30;
export const MIN_ACCEPT_RETURNS_DAYS = 1;
export const MAX_ACCEPT_RETURNS_DAYS = 365;

export function clampAcceptReturnsDays(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(Number(n))) return DEFAULT_ACCEPT_RETURNS_DAYS;
  return Math.min(MAX_ACCEPT_RETURNS_DAYS, Math.max(MIN_ACCEPT_RETURNS_DAYS, Math.round(Number(n))));
}

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function laterOf(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined
): Date | null {
  const da = toValidDate(a);
  const db = toValidDate(b);
  if (da && db) return da.getTime() >= db.getTime() ? da : db;
  return da ?? db;
}

export type ReturnWindowOrder = {
  createdAt?: string | Date | null;
  items?: { fulfillmentType?: string | null }[] | null;
  pickupSellerConfirmedAt?: string | Date | null;
  pickupBuyerConfirmedAt?: string | Date | null;
  deliveryConfirmedAt?: string | Date | null;
  deliveryBuyerConfirmedAt?: string | Date | null;
  shipment?: { createdAt?: string | Date | null; trackingStatus?: string | null } | null;
};

export function returnWindowStartAt(order: ReturnWindowOrder): Date | null {
  const items = order.items ?? [];
  const hasPickup = items.some((i) => (i.fulfillmentType ?? "") === "pickup");
  const hasDelivery = items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");
  if (hasPickup) {
    const pickup = laterOf(order.pickupSellerConfirmedAt, order.pickupBuyerConfirmedAt);
    if (pickup) return pickup;
  }
  if (hasDelivery) {
    const delivery = laterOf(order.deliveryConfirmedAt, order.deliveryBuyerConfirmedAt);
    if (delivery) return delivery;
  }
  const shipped = toValidDate(order.shipment?.createdAt);
  if (shipped) return shipped;
  return toValidDate(order.createdAt);
}

export function returnWindowEndsAt(
  order: ReturnWindowOrder,
  days?: number | null
): Date | null {
  const start = returnWindowStartAt(order);
  if (!start) return null;
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + clampAcceptReturnsDays(days));
  return end;
}

export function isReturnWindowOpen(
  order: ReturnWindowOrder,
  days?: number | null,
  now: Date = new Date()
): boolean {
  const end = returnWindowEndsAt(order, days);
  if (!end) return true;
  return now.getTime() <= end.getTime();
}

export function buyerReturnPolicyFields(
  seller: {
    acceptReturns?: boolean | null;
    acceptReturnsDays?: number | null;
    chargeReturnShipping?: boolean | null;
  },
  order: ReturnWindowOrder
) {
  const days = clampAcceptReturnsDays(seller.acceptReturnsDays);
  return {
    sellerAcceptsReturns: seller.acceptReturns !== false,
    sellerAcceptsReturnsDays: days,
    sellerChargeReturnShipping: seller.chargeReturnShipping === true,
    returnWindowEndsAt: returnWindowEndsAt(order, days)?.toISOString() ?? null,
  };
}

export function buyerCanRequestRefund(
  order: {
    status: string;
    isCashOrder?: boolean;
    stripePaymentIntentId?: string | null;
    sellerAcceptsReturns?: boolean;
    sellerAcceptsReturnsDays?: number | null;
    returnWindowEndsAt?: string | Date | null;
    storeReturn?: { status: string } | null;
    refundRequestedAt?: string | Date | null;
  } & ReturnWindowOrder,
  now: Date = new Date()
): boolean {
  if (order.sellerAcceptsReturns === false) return false;
  if (order.isCashOrder) return false;
  if (order.stripePaymentIntentId === null) return false;
  if (order.status !== "shipped" && order.status !== "delivered") return false;
  if (order.storeReturn && isActiveStoreReturnStatus(order.storeReturn.status)) return false;
  if (order.storeReturn?.status === "refunded") return false;
  if (!order.storeReturn && order.refundRequestedAt) return false;
  if (order.returnWindowEndsAt) {
    const end = toValidDate(order.returnWindowEndsAt);
    if (end && now.getTime() > end.getTime()) return false;
  } else if (!isReturnWindowOpen(order, order.sellerAcceptsReturnsDays, now)) {
    return false;
  }
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

export const BUYER_RETURN_SHIPPING_WARNING =
  "This seller charges return shipping. The Shippo return-label price will be deducted from your refund once the seller buys the label. The exact amount is set at that time.";

export function sellerReturnPolicySummary(seller: {
  acceptReturns?: boolean;
  acceptReturnsDays?: number | null;
  chargeReturnShipping?: boolean;
  sellerReturnPolicy?: string | null;
}): string {
  if (seller.acceptReturns === false) {
    return seller.sellerReturnPolicy?.trim() || "This seller does not accept returns.";
  }
  const days = clampAcceptReturnsDays(seller.acceptReturnsDays);
  const windowLine = `Returns within ${days} days of delivery or pickup.`;
  const shipLine = seller.chargeReturnShipping
    ? " Return shipping may be deducted from your refund."
    : "";
  const extra = seller.sellerReturnPolicy?.trim();
  return extra ? `${windowLine}${shipLine}\n\n${extra}` : `${windowLine}${shipLine}`;
}

export function storeReturnBuyerLabel(
  status: string | null | undefined,
  opts?: { hasReturnLabel?: boolean }
): string | null {
  if (!status) return null;
  if (status === "requested") return "Return requested. Waiting for the seller to review.";
  if (status === "awaiting_return") {
    return opts?.hasReturnLabel
      ? "Your return has been approved. Print your return label now."
      : "Return approved. A return label will appear on this order when the seller sends it.";
  }
  if (status === "in_transit") return "Return in transit to the seller.";
  if (status === "received") return "Seller received your return. Refund is being processed.";
  if (status === "refunded") return "Refund Initiated. It can take several business days to appear on your statement.";
  if (status === "declined") return "The seller declined this return request.";
  if (status === "canceled") return "This return was canceled.";
  return null;
}

/** Mail orders can get a Shippo return label after approve, until one is already on file. */
export function orderCanBuyReturnLabel(order: {
  items: Array<{ fulfillmentType?: string | null }>;
  returnShipment?: { labelUrl?: string | null } | null;
}): boolean {
  const hasShip = order.items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  return hasShip && !order.returnShipment?.labelUrl;
}
