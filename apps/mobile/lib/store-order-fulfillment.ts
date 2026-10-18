/** Keep in sync with packages/types/src/store-order-fulfillment.ts (Metro cannot resolve workspace `types`). */

export type FulfillmentTabKey = "ship" | "pickups" | "deliveries" | "shipped" | "history";

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
  taxCents?: number;
  subtotalCents?: number;
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

function postalAddressKey(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = o[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const street = pick("street", "address", "line1", "addressLine1", "street1");
  const city = pick("city", "town", "locality");
  const state = pick("state", "state_code", "province", "region");
  const zip = pick("zip", "postal_code", "postalCode", "zipCode").replace(/\D/g, "").slice(0, 10);
  const apt = pick("aptOrSuite", "street2", "address2", "line2", "unit");
  if (!street || !city || !state || zip.length < 5) return null;
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return [street, apt, city, state, zip].map(norm).join("|");
}

/** Same rule as the website: two or more orders, one buyer email, one checkout address. */
export function ordersCanCombineShipping(
  orders: Array<{ buyer?: { email?: string | null }; shippingAddress?: unknown }>
): boolean {
  if (orders.length < 2) return false;
  const emails = orders.map((order) => order.buyer?.email?.trim().toLowerCase() ?? "");
  if (emails.some((email) => !email) || new Set(emails).size !== 1) return false;
  const keys = orders.map((order) => postalAddressKey(order.shippingAddress));
  if (keys.some((key) => !key) || new Set(keys).size !== 1) return false;
  return true;
}

/** Groups of two or more orders that share a buyer email and checkout address. */
export function clusterOrdersForCombinedShipping<
  T extends { id: string; buyer?: { email?: string | null }; shippingAddress?: unknown },
>(orders: T[]): T[][] {
  const buckets = new Map<string, T[]>();
  for (const order of orders) {
    const email = order.buyer?.email?.trim().toLowerCase() ?? "";
    const address = postalAddressKey(order.shippingAddress);
    if (!email || !address) continue;
    const key = `${email}|${address}`;
    const list = buckets.get(key);
    if (list) list.push(order);
    else buckets.set(key, [order]);
  }
  return [...buckets.values()].filter((group) => group.length >= 2);
}

/** One label, and one packing slip, per explicit box. Orders left out stay separate. */
export function labelGroupsForSelection(selectedIds: string[], combinedGroups: string[][]): string[][] {
  const selected = new Set(selectedIds);
  const used = new Set<string>();
  const groups: string[][] = [];
  for (const group of combinedGroups) {
    const ids = [...new Set(group.filter((id) => selected.has(id)))];
    if (ids.length >= 2 && ids.length === group.length) {
      groups.push(ids);
      ids.forEach((id) => used.add(id));
    }
  }
  for (const id of selectedIds) {
    if (!used.has(id)) groups.push([id]);
  }
  return groups;
}

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

export function formatSellerOrderTotal(
  order: Pick<StoreOrderSummary, "orderKind" | "totalCents" | "taxCents">
): string {
  if (order.orderKind === "reward_redemption" && order.totalCents === 0) {
    return "No charge (reward)";
  }
  const grand = order.totalCents + (order.taxCents ?? 0);
  return `$${(grand / 100).toFixed(2)}`;
}

export function sellerOrderPaymentLabel(order: {
  stripePaymentIntentId?: string | null;
  orderKind?: string;
  totalCents?: number;
}): "Paid Online" | "Reward" {
  if (order.orderKind === "reward_redemption" && (order.totalCents ?? 0) === 0) return "Reward";
  return "Paid Online";
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
