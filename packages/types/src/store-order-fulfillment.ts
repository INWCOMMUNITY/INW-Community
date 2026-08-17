/**
 * Shared store-order fulfillment helpers for web, mobile, and API.
 */

export type FulfillmentTabKey = "ship" | "pickups" | "deliveries" | "history";

export type OrderLineItemSummary = {
  quantity: number;
  fulfillmentType?: string | null;
  storeItem?: { id?: string; title?: string; slug?: string; photos?: string[] };
};

export type StoreOrderSummary = {
  id: string;
  orderNumber?: string;
  orderKind?: string;
  status: string;
  totalCents: number;
  shippingCostCents?: number;
  stripePaymentIntentId?: string | null;
  shippingAddress?: unknown;
  createdAt: string;
  buyer?: { firstName?: string; lastName?: string; email?: string };
  items?: OrderLineItemSummary[];
  shipment?: { carrier?: string; trackingNumber?: string | null; labelUrl?: string | null } | null;
  shippedWithOrderId?: string | null;
  pickupSellerConfirmedAt?: string | Date | null;
  deliveryConfirmedAt?: string | Date | null;
};

export function orderHasShippedLine(items: { fulfillmentType?: string | null }[] | undefined): boolean {
  return (items ?? []).some((i) => (i.fulfillmentType ?? "ship") === "ship");
}

export function orderHasPickupLine(items: { fulfillmentType?: string | null }[] | undefined): boolean {
  return (items ?? []).some((i) => (i.fulfillmentType ?? "") === "pickup");
}

export function orderHasLocalDeliveryLine(items: { fulfillmentType?: string | null }[] | undefined): boolean {
  return (items ?? []).some((i) => (i.fulfillmentType ?? "") === "local_delivery");
}

export function isOrderEligibleForToShipQueue(order: {
  status: string;
  shipment?: unknown | null;
  shippedWithOrderId?: string | null;
  items?: { fulfillmentType?: string | null }[];
}): boolean {
  return (
    order.status === "paid" &&
    !order.shipment &&
    !order.shippedWithOrderId &&
    orderHasShippedLine(order.items)
  );
}

export function filterOrdersForPickupTab<T extends { items?: { fulfillmentType?: string | null }[] }>(
  orders: T[]
): T[] {
  return orders.filter((o) => orderHasPickupLine(o.items));
}

export function filterOrdersForDeliveryTab<
  T extends { items?: { fulfillmentType?: string | null }[]; localDeliveryDetails?: unknown },
>(orders: T[]): T[] {
  return orders.filter((o) => orderHasLocalDeliveryLine(o.items));
}

export function getTrackingUrl(carrier: string, trackingNumber: string): string {
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  return `https://www.google.com/search?q=track+${encodeURIComponent(trackingNumber)}`;
}

export function formatSellerOrderTotal(order: Pick<StoreOrderSummary, "orderKind" | "totalCents">): string {
  if (order.orderKind === "reward_redemption" && order.totalCents === 0) {
    return "No charge to member (reward)";
  }
  return `$${(order.totalCents / 100).toFixed(2)}`;
}

export function sellerOrderPaymentLabel(order: {
  stripePaymentIntentId?: string | null;
  orderKind?: string;
  totalCents?: number;
}): "Paid online" | "Cash due" | "Reward" {
  if (order.orderKind === "reward_redemption" && (order.totalCents ?? 0) === 0) return "Reward";
  return order.stripePaymentIntentId ? "Paid online" : "Cash due";
}

export function orderFulfillmentBadge(order: { items?: { fulfillmentType?: string | null }[] }): string {
  const hasShip = orderHasShippedLine(order.items);
  const hasPickup = orderHasPickupLine(order.items);
  const hasDelivery = orderHasLocalDeliveryLine(order.items);
  const count = [hasShip, hasPickup, hasDelivery].filter(Boolean).length;
  if (count > 1) return "Mixed fulfillment";
  if (hasShip) return "Ship";
  if (hasPickup) return "Pickup";
  if (hasDelivery) return "Local delivery";
  return "Fulfillment";
}
