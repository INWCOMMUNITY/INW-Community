/**
 * Minimal store-order fields for “purchase another label” (Shippo) eligibility.
 * Mirror: `apps/mobile/lib/shippo-order-label-eligibility.ts` (Expo Metro cannot import this package).
 */

export interface StoreOrderForAnotherLabel {
  status: string;
  shipment?: unknown | null;
}

/**
 * True when the seller may open Shippo for an additional label to the same order / address.
 * Excludes first-time purchase (paid, no shipment) and canceled/refunded orders.
 * Allows shipped/delivered even when `shipment` is missing on the payload (e.g. edge API cases).
 */
export function orderEligibleForAnotherShippoLabel(order: StoreOrderForAnotherLabel | null): boolean {
  if (!order) return false;
  const bad =
    order.status === "canceled" ||
    order.status === "refunded" ||
    order.status === "cancelled";
  if (bad) return false;
  if (order.status === "paid" && !order.shipment) return false;
  return (
    order.status === "paid" || order.status === "shipped" || order.status === "delivered"
  );
}
