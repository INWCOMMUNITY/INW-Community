/** Seller choice after a return label is sent. Stored on the order JSON so it does not need a new column. */

export const NWC_RETURN_REFUND_TIMING_KEY = "nwcReturnRefundTiming";

export type ReturnRefundTiming = "now" | "on_arrival";

export function readReturnRefundTiming(details: unknown): ReturnRefundTiming | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const value = (details as Record<string, unknown>)[NWC_RETURN_REFUND_TIMING_KEY];
  return value === "now" || value === "on_arrival" ? value : null;
}

export function withReturnRefundTiming(details: unknown, timing: ReturnRefundTiming): Record<string, unknown> {
  const base =
    details && typeof details === "object" && !Array.isArray(details)
      ? { ...(details as Record<string, unknown>) }
      : {};
  base[NWC_RETURN_REFUND_TIMING_KEY] = timing;
  return base;
}

type ReturnLabelOrder = {
  status?: string | null;
  localDeliveryDetails?: unknown;
  storeReturn?: { status?: string | null } | null;
  returnShipment?: { labelUrl?: string | null } | null;
};

function returnIsOpen(order: ReturnLabelOrder): boolean {
  if (order.status === "refunded") return false;
  const status = order.storeReturn?.status;
  return status === "awaiting_return" || status === "in_transit";
}

/** Seller still needs to buy and send the buyer’s return label. */
export function returnLabelIsDue(order: ReturnLabelOrder): boolean {
  return returnIsOpen(order) && !order.returnShipment?.labelUrl;
}

/** Label is out, and the seller has not chosen when to refund. */
export function sellerMustChooseReturnRefundTiming(order: ReturnLabelOrder): boolean {
  if (!returnIsOpen(order) || !order.returnShipment?.labelUrl) return false;
  return readReturnRefundTiming(order.localDeliveryDetails) == null;
}
