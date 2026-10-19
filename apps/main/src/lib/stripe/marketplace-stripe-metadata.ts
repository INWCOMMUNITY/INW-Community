/**
 * Human-readable Stripe metadata for the NWC Marketplace account.
 * Keys match what we call things in the app / Seller Hub / My Orders.
 */

export type MarketplaceCheckoutMetadataInput = {
  orderIds: string[];
  resaleOfferIds?: string[];
};

export type MarketplaceTransferMetadataInput = {
  storeOrderId: string;
  /** App name: "Seller payout" / Connect transfer after fulfill */
  purpose?: "seller_payout" | "return_entitlement";
};

export type MarketplaceRefundMetadataInput = {
  storeOrderId: string;
  /** App: buyer cancel/return vs seller cancel/courtesy */
  stripeFeeBearer: "buyer" | "seller";
  /** App labels */
  reason?: string;
  refundOperationId?: string | null;
};

export type MarketplaceTransferReversalMetadataInput = {
  storeOrderId: string;
  refundOperationId?: string | null;
  purpose?: "order_refund" | "return_settlement";
};

const META_MAX = 500;

function clip(value: string, max = META_MAX): string {
  return value.length <= max ? value : value.slice(0, max);
}

function chunkOrderIds(orderIds: string[]): Record<string, string> {
  const orderIdsStr = orderIds.join(",");
  const out: Record<string, string> = {
    product: "NWC Marketplace",
    flow: "storefront_checkout",
  };
  if (orderIdsStr.length <= META_MAX) {
    out.orderIds = orderIdsStr;
    out.store_order_ids = orderIdsStr;
    return out;
  }
  const parts = orderIdsStr.split(",");
  let chunk = "";
  let idx = 0;
  for (const part of parts) {
    const next = chunk ? `${chunk},${part}` : part;
    if (next.length > META_MAX && chunk) {
      out[`orderIds_${idx}`] = chunk;
      idx += 1;
      chunk = part;
    } else {
      chunk = next;
    }
  }
  if (chunk) out[`orderIds_${idx}`] = chunk;
  return out;
}

/** Checkout Session + PaymentIntent metadata (copied onto the charge when possible). */
export function marketplaceCheckoutMetadata(
  input: MarketplaceCheckoutMetadataInput
): Record<string, string> {
  const meta = chunkOrderIds(input.orderIds);
  const resale = (input.resaleOfferIds ?? []).join(",");
  if (resale) {
    meta.resaleOfferIds = clip(resale);
    meta.resale_offer_ids = clip(resale);
  }
  return meta;
}

/** Connect transfer after order fulfill (“seller payout” in the app). */
export function marketplaceTransferMetadata(
  input: MarketplaceTransferMetadataInput
): Record<string, string> {
  const purpose = input.purpose ?? "seller_payout";
  return {
    product: "NWC Marketplace",
    flow: purpose === "return_entitlement" ? "return_seller_entitlement" : "seller_payout",
    storeOrderId: input.storeOrderId,
    store_order_id: input.storeOrderId,
    label: purpose === "return_entitlement" ? "Return seller entitlement" : "Seller payout",
  };
}

/** Card refund to the buyer. */
export function marketplaceRefundMetadata(
  input: MarketplaceRefundMetadataInput
): Record<string, string> {
  const meta: Record<string, string> = {
    product: "NWC Marketplace",
    flow: "storefront_refund",
    storeOrderId: input.storeOrderId,
    store_order_id: input.storeOrderId,
    stripe_fee_bearer: input.stripeFeeBearer,
    fee_bearer_label:
      input.stripeFeeBearer === "seller"
        ? "Seller absorbs Stripe fees (full card refund)"
        : "Buyer refund deducts Stripe fees",
    label:
      input.stripeFeeBearer === "seller"
        ? "Seller-initiated / courtesy refund"
        : "Buyer cancel or return refund",
  };
  if (input.reason?.trim()) meta.reason = clip(input.reason.trim());
  const ro = input.refundOperationId?.trim();
  if (ro) {
    meta.refundOperationId = ro;
    meta.refund_operation_id = ro;
  }
  return meta;
}

/** Connect transfer reversal when unwinding a seller payout. */
export function marketplaceTransferReversalMetadata(
  input: MarketplaceTransferReversalMetadataInput
): Record<string, string> {
  const meta: Record<string, string> = {
    product: "NWC Marketplace",
    flow: input.purpose === "return_settlement" ? "return_transfer_reversal" : "refund_transfer_reversal",
    storeOrderId: input.storeOrderId,
    store_order_id: input.storeOrderId,
    label: "Reverse seller payout",
  };
  const ro = input.refundOperationId?.trim();
  if (ro) {
    meta.refundOperationId = ro;
    meta.refund_operation_id = ro;
  }
  return meta;
}

/** Account debit pulling non-refundable Stripe fees from the seller’s Connect balance. */
export function marketplaceSellerFeeRecoveryMetadata(input: {
  storeOrderId: string;
  refundOperationId?: string | null;
  amountCents: number;
}): Record<string, string> {
  const meta: Record<string, string> = {
    product: "NWC Marketplace",
    flow: "seller_fee_recovery",
    storeOrderId: input.storeOrderId,
    store_order_id: input.storeOrderId,
    label: "Seller Stripe fee recovery",
    amount_cents: String(input.amountCents),
  };
  const ro = input.refundOperationId?.trim();
  if (ro) {
    meta.refundOperationId = ro;
    meta.refund_operation_id = ro;
  }
  return meta;
}
