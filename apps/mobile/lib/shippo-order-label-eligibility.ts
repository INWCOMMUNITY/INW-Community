/**
 * Keep in sync with `packages/types/src/shippo-order-label-eligibility.ts` (Metro cannot resolve workspace `types`).
 */

export interface StoreOrderForAnotherLabel {
  status: string;
  shipment?: unknown | null;
}

export function orderHasShippedLine(items: { fulfillmentType?: string | null }[] | undefined): boolean {
  return (items ?? []).some((i) => (i.fulfillmentType ?? "ship") === "ship");
}

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
