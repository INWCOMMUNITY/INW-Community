/** Storefront return status machine and refund-amount helpers. */

import {
  computeStripeProcessingFeeCents,
  computeStripeTaxProductFeeCents,
} from "@/lib/storefront-payout";
import { payerForReason, policyFromStored, sellerPolicyName } from "@/lib/seller-return-label-policy";

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

/** Seller Refunds & Cancellations: open returns plus finished ones. */
export const SELLER_RETURNS_PAGE_STATUSES: readonly StoreReturnStatus[] = [
  ...ACTIVE_STORE_RETURN_STATUSES,
  "refunded",
  "declined",
  "canceled",
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

/**
 * `received` means physical possession, not financial completion
 * (buyer copy: "Refund is being processed.").
 * Receive/refund may re-enter while the return is physically received
 * but StoreReturn is not yet `refunded`.
 */
export function isReturnReceiveRefundRetryable(status: string | null | undefined): boolean {
  return isAwaitingReturnStatus(status) || status === "received";
}

export type StoreReturnSellerMoneyAction = "receive" | "retry_refund";

export const STORE_RETURN_RECEIVE_ACTION_LABEL = "Mark Received & Refund";
export const STORE_RETURN_RETRY_REFUND_ACTION_LABEL = "Retry refund";

/**
 * Seller web/mobile money action. `received` stays physical fact;
 * Retry refund re-enters the same receive/refund route until StoreOrder is refunded.
 */
export function storeReturnSellerMoneyAction(args: {
  returnStatus?: string | null;
  orderStatus?: string | null;
}): StoreReturnSellerMoneyAction | null {
  if (args.orderStatus === "refunded") return null;
  if (args.returnStatus === "refunded") return null;
  if (isAwaitingReturnStatus(args.returnStatus)) return "receive";
  if (args.returnStatus === "received") return "retry_refund";
  return null;
}

export function storeReturnSellerMoneyActionLabel(action: StoreReturnSellerMoneyAction | null): string | null {
  if (action === "receive") return STORE_RETURN_RECEIVE_ACTION_LABEL;
  if (action === "retry_refund") return STORE_RETURN_RETRY_REFUND_ACTION_LABEL;
  return null;
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

/**
 * Mail, pickup, or local delivery has left the pre-shipment cancel stage.
 * A purchased label counts even when StoreOrder.status is still "paid"
 * (status often stays paid until tracking is delivered).
 */
export function buyerFulfillmentHasStarted(order: {
  status: string;
  shipment?: {
    createdAt?: string | Date | null;
    trackingNumber?: string | null;
    trackingStatus?: string | null;
  } | null;
  pickupSellerConfirmedAt?: string | Date | null;
  pickupBuyerConfirmedAt?: string | Date | null;
  deliveryConfirmedAt?: string | Date | null;
  deliveryBuyerConfirmedAt?: string | Date | null;
}): boolean {
  if (order.status === "shipped" || order.status === "delivered") return true;
  if (order.status !== "paid") return false;
  if (order.shipment) return true;
  if (order.pickupSellerConfirmedAt && order.pickupBuyerConfirmedAt) return true;
  if (order.deliveryConfirmedAt && order.deliveryBuyerConfirmedAt) return true;
  return false;
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
    returnLabelPayer?: string | null;
    returnLabelPayerByReason?: unknown;
    firstName?: string | null;
    lastName?: string | null;
    businesses?: { name?: string | null }[];
  },
  order: ReturnWindowOrder
) {
  const days = clampAcceptReturnsDays(seller.acceptReturnsDays);
  const policy = policyFromStored(seller);
  return {
    sellerAcceptsReturns: true,
    sellerAcceptsReturnsDays: days,
    sellerChargeReturnShipping: policy.returnLabelPayer === "buyer",
    sellerPolicyName: sellerPolicyName({
      businessName: seller.businesses?.[0]?.name,
      firstName: seller.firstName,
      lastName: seller.lastName,
    }),
    returnLabelPayer: policy.returnLabelPayer,
    returnLabelPayerByReason: policy.returnLabelPayerByReason,
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
  if (!buyerFulfillmentHasStarted(order)) return false;
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
 * Stripe keeps card processing (~2.9%+$0.30) and the Stripe Tax product fee (0.5% when tax
 * was collected) when a charge is refunded. Those amounts are deducted from the buyer's
 * refund so the platform is not left covering Stripe's non-refundable fees.
 */
export function nonRefundableStripeFeeCents(order: {
  totalCents: number;
  taxCents?: number | null;
}): number {
  const charge = fullRefundChargeCents(order);
  const taxCents = Math.max(0, order.taxCents ?? 0);
  return (
    computeStripeProcessingFeeCents(charge) + computeStripeTaxProductFeeCents(charge, taxCents)
  );
}

/** Buyer card refund before optional return-shipping deduction (buyer bears Stripe fees). */
export function buyerCardRefundCents(order: {
  totalCents: number;
  taxCents?: number | null;
}): number {
  return Math.max(0, fullRefundChargeCents(order) - nonRefundableStripeFeeCents(order));
}

/**
 * Who absorbs Stripe’s non-refundable processing fees on a storefront refund.
 * - buyer: deducted from the card refund (buyer cancel / buyer return)
 * - seller: buyer is refunded in full; seller’s My Funds debit includes the fee
 */
export type StorefrontStripeFeeBearer = "buyer" | "seller";

export function buyerRefundCentsForFeeBearer(
  order: { totalCents: number; taxCents?: number | null },
  bearer: StorefrontStripeFeeBearer
): number {
  return bearer === "seller" ? fullRefundChargeCents(order) : buyerCardRefundCents(order);
}

/**
 * Buyer refund when a return completes.
 * Deducts non-refundable Stripe fees, then the return-label cost when chargeReturnShipping is on.
 */
export function returnRefundAmountCents(args: {
  totalCents: number;
  taxCents?: number | null;
  chargeReturnShipping: boolean;
  returnLabelCostCents?: number | null;
}): number {
  const base = buyerCardRefundCents(args);
  if (!args.chargeReturnShipping) return base;
  return Math.max(0, base - Math.max(0, args.returnLabelCostCents ?? 0));
}

export type BuyerRefundBreakdownLine = {
  label: string;
  /** Null when the amount is not known yet. Deductions are positive cents, shown as subtracted. */
  cents: number | null;
  kind: "credit" | "deduction";
  detail: string | null;
};

export type BuyerRefundBreakdown = {
  title: "Expected refund" | "Refund";
  lines: BuyerRefundBreakdownLine[];
  expectedCents: number;
  footnote: string | null;
};

const BUYER_REFUND_BREAKDOWN_STATUSES = new Set([
  "requested",
  "awaiting_return",
  "in_transit",
  "received",
  "refunded",
]);

const SELLER_ABSORBS_STRIPE_FEE_REASONS = new Set([
  "Seller canceled & refunded",
  "Seller canceled delivery",
  "requested_by_seller",
  "Courtesy refund",
]);

function sellerAbsorbsStripeFee(args: {
  cancelReason?: string | null;
  returnReason?: string | null;
}): boolean {
  return (
    SELLER_ABSORBS_STRIPE_FEE_REASONS.has(args.cancelReason ?? "") ||
    SELLER_ABSORBS_STRIPE_FEE_REASONS.has(args.returnReason ?? "")
  );
}

/**
 * What the buyer can expect back, with each amount that makes up that refund.
 * Seller cancels and courtesy refunds return the full charge. Buyer cancels and
 * returns deduct Stripe's non-refundable fees, then the return label when the buyer pays it.
 */
export function buyerRefundBreakdown(order: {
  status?: string | null;
  isCashOrder?: boolean;
  totalCents: number;
  subtotalCents?: number | null;
  shippingCostCents?: number | null;
  taxCents?: number | null;
  cancelReason?: string | null;
  refundInitiatedAt?: string | Date | null;
  refundCompletedAt?: string | Date | null;
  returnLabelPayer?: string | null;
  returnLabelPayerByReason?: unknown;
  storeReturn?: {
    status?: string | null;
    reason?: string | null;
    chargeReturnShipping?: boolean | null;
    returnLabelCostCents?: number | null;
  } | null;
}): BuyerRefundBreakdown | null {
  if (order.isCashOrder) return null;
  const returnStatus = order.storeReturn?.status ?? null;
  const returnOpen = returnStatus != null && BUYER_REFUND_BREAKDOWN_STATUSES.has(returnStatus);
  const orderRefunded = order.status === "refunded" || order.status === "canceled" || Boolean(order.refundInitiatedAt);
  if (!returnOpen && !orderRefunded) return null;

  const sellerAbsorbs = sellerAbsorbsStripeFee({
    cancelReason: order.cancelReason,
    returnReason: order.storeReturn?.reason,
  });
  const preTax = Math.max(0, order.totalCents);
  const subtotal = Math.max(0, order.subtotalCents ?? 0);
  const shipping = Math.max(0, order.shippingCostCents ?? 0);
  const tax = Math.max(0, order.taxCents ?? 0);
  const paid = preTax + tax;
  const processing = sellerAbsorbs ? 0 : computeStripeProcessingFeeCents(paid);
  const taxFee = sellerAbsorbs ? 0 : computeStripeTaxProductFeeCents(paid, tax);
  const chargeLabel = Boolean(order.storeReturn?.chargeReturnShipping) && !sellerAbsorbs;
  const labelCost = Math.max(0, order.storeReturn?.returnLabelCostCents ?? 0);
  const labelKnown = chargeLabel && labelCost > 0;
  const settled = returnStatus === "refunded" || returnStatus === "received" || order.status === "refunded";
  const labelPending = chargeLabel && !labelKnown && !settled;
  const labelPayer = payerForReason(
    policyFromStored({
      returnLabelPayer: order.returnLabelPayer,
      returnLabelPayerByReason: order.returnLabelPayerByReason,
    }),
    order.storeReturn?.reason
  );
  const expectedCents = Math.max(0, (sellerAbsorbs ? paid : paid - processing - taxFee) - (labelKnown ? labelCost : 0));

  const lines: BuyerRefundBreakdownLine[] = [];
  const partsMatch = subtotal > 0 && subtotal + shipping === preTax;
  if (partsMatch) {
    lines.push({ label: "Items", cents: subtotal, kind: "credit", detail: null });
    if (shipping > 0) lines.push({ label: "Shipping", cents: shipping, kind: "credit", detail: null });
  } else {
    lines.push({ label: "Order total", cents: preTax, kind: "credit", detail: null });
  }
  if (tax > 0) lines.push({ label: "Tax", cents: tax, kind: "credit", detail: null });
  if (processing > 0) {
    lines.push({ label: "Card processing fee", cents: processing, kind: "deduction", detail: null });
  }
  if (taxFee > 0) {
    lines.push({ label: "Sales tax fee", cents: taxFee, kind: "deduction", detail: null });
  }
  if (labelKnown) {
    lines.push({ label: "Return label", cents: labelCost, kind: "deduction", detail: null });
  } else if (labelPending) {
    lines.push({
      label: "Return label",
      cents: null,
      kind: "deduction",
      detail: labelPayer === "later" ? "Seller decides" : "Deducted when purchased",
    });
  }

  const complete = returnStatus === "refunded" || order.status === "refunded" || Boolean(order.refundCompletedAt);
  const footnote = labelPending
    ? labelPayer === "later"
      ? "If the seller charges you for the return label, its price will be deducted from this amount."
      : "The return label price will be deducted from this amount when the seller buys it."
    : null;

  return {
    title: complete ? "Refund" : "Expected refund",
    lines,
    expectedCents,
    footnote,
  };
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

/**
 * Seller Connect cents retained after a return: original sale transfer minus the
 * reversal that would apply if that transfer had already succeeded.
 * Never negative; never greater than the original transfer.
 */
export function postReturnSellerEntitlementCents(args: {
  originalTransferCents: number;
  chargeReturnShipping: boolean;
  returnLabelCostCents?: number | null;
}): number {
  const original = Math.max(0, args.originalTransferCents);
  const reversal = sellerTransferReversalCents(args);
  return Math.max(0, original - reversal);
}

export const BUYER_RETURN_SHIPPING_WARNING =
  "This seller charges return shipping. The Shippo return-label price will be deducted from your refund once the seller buys the label. The exact amount is set at that time.";

/** Title for the buyer cancel / refund policy confirmation popup. */
export const BUYER_REFUND_POLICY_POPUP_TITLE = "NWC Marketplace Refund Policy";

/**
 * Body for the buyer cancel / refund policy confirmation popup.
 * Exact fee is shown separately via {@link formatBuyerRefundFeeDeductionLine}.
 */
export const BUYER_REFUND_POLICY_POPUP_BODY =
  "NWC does not personally profit off of items sold in the storefront. Stripe’s credit card processing does not refund their portion, and therefore that processing fee will be eaten by the buyer on a refund request — rather than charging the seller for that fee twice.";

export const BUYER_REFUND_POLICY_CONTINUE_LABEL = "Understood";
export const BUYER_REFUND_POLICY_NEVERMIND_LABEL = "Nevermind.";

/** @deprecated Use BUYER_REFUND_POLICY_POPUP_BODY — kept for any lingering imports. */
export const BUYER_STRIPE_FEE_NON_REFUNDABLE_NOTICE = BUYER_REFUND_POLICY_POPUP_BODY;

export function formatBuyerRefundFeeDeductionLine(order: {
  totalCents: number;
  taxCents?: number | null;
}): string {
  const feeCents = nonRefundableStripeFeeCents(order);
  return `Fee deducted from your refund: $${(feeCents / 100).toFixed(2)}`;
}

/** Title for seller cancel / courtesy refund policy confirmation. */
export const SELLER_REFUND_POLICY_POPUP_TITLE = "NWC Marketplace Refund Policy";

export const SELLER_REFUND_POLICY_POPUP_BODY =
  "NWC does not personally profit off of items sold in the storefront. Stripe’s credit card processing does not refund their portion when you cancel and refund an order. The buyer is refunded in full, and that processing fee is absorbed on the seller side — rather than deducting it from the buyer.";

export const SELLER_REFUND_POLICY_FEE_LINE_PREFIX = "Stripe fee you absorb on this refund:";

export function formatSellerRefundFeeAbsorptionLine(order: {
  totalCents: number;
  taxCents?: number | null;
}): string {
  const feeCents = nonRefundableStripeFeeCents(order);
  return `${SELLER_REFUND_POLICY_FEE_LINE_PREFIX} $${(feeCents / 100).toFixed(2)}`;
}

/**
 * Shown on product / seller “Seller Policy” sections so buyers know NWC’s marketplace refund rules.
 */
export const NWC_MARKETPLACE_REFUND_POLICY_PRODUCT_TITLE = "NWC Marketplace Refund Policy";

export const NWC_MARKETPLACE_REFUND_POLICY_PRODUCT_TEXT =
  "NWC does not personally profit off of items sold in the storefront. Stripe does not return its card processing fees when a payment is refunded.\n\n" +
  "If you (the buyer) cancel or request a refund/return, Stripe’s non-refundable processing fee is deducted from your refund. If the seller cancels and refunds the order, you are refunded in full and the seller absorbs that fee.\n\n" +
  "Typical Stripe fees are about 2.9% + $0.30 of the original charge, plus Stripe Tax’s 0.5% product fee when sales tax was collected. Return shipping may also be deducted when the seller’s return policy charges it.";

export function sellerReturnPolicySummary(seller: {
  acceptReturns?: boolean;
  acceptReturnsDays?: number | null;
  chargeReturnShipping?: boolean;
  sellerReturnPolicy?: string | null;
}): string {
  const shipLine = seller.chargeReturnShipping
    ? "Return shipping may be deducted from your refund."
    : "";
  const extra = seller.sellerReturnPolicy?.trim();
  if (extra && shipLine) return `${shipLine}\n\n${extra}`;
  return extra || shipLine;
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
