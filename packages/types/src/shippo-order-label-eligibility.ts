/**
 * Minimal store-order fields for “purchase another label” (Shippo) eligibility.
 * Mirror: `apps/mobile/lib/shippo-order-label-eligibility.ts` (Expo Metro cannot import this package).
 */

export interface StoreOrderForAnotherLabel {
  status: string;
  shipment?: unknown | null;
}

export { orderHasShippedLine } from "./store-order-fulfillment";

/**
 * True when the seller may open Shippo for an additional label to the same order / address.
 * Excludes first-time purchase (paid, no shipment), canceled/refunded, and **delivered** (no new labels).
 * Allows paid-with-shipment or shipped when `shipment` exists; allows shipped when `shipment` is missing (edge payloads).
 */
export function orderEligibleForAnotherShippoLabel(order: StoreOrderForAnotherLabel | null): boolean {
  if (!order) return false;
  const bad =
    order.status === "canceled" ||
    order.status === "refunded" ||
    order.status === "cancelled";
  if (bad) return false;
  if (order.status === "delivered") return false;
  if (order.status === "paid" && !order.shipment) return false;
  return order.status === "paid" || order.status === "shipped";
}
