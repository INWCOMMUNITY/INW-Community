import { getOrderStatusLabel } from "@/lib/order-status";
import {
  getTrackingUrl,
  orderHasLocalDeliveryLine,
  orderHasPickupLine,
  orderHasShippedLine,
} from "@/lib/store-order-fulfillment";

export const BUYER_ORDER_TABS = [
  { key: "to_receive", label: "To Receive" },
  { key: "delivered", label: "Delivered" },
  { key: "canceled", label: "Canceled" },
  { key: "all", label: "All" },
] as const;

export type BuyerOrderTab = (typeof BUYER_ORDER_TABS)[number]["key"];

export const BUYER_ORDER_REASONS = [
  "Changed my mind",
  "Didn't mean to order",
  "Order Arrived Damaged",
  "Wrong Item Delivered",
  "Other",
] as const;

export type BuyerOrderItem = {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  fulfillmentType?: string | null;
  pickupDetails?: Record<string, unknown> | null;
  storeItem?: {
    id: string;
    title: string;
    slug: string;
    photos: string[];
  } | null;
};

export type BuyerShipment = {
  id?: string;
  carrier: string;
  service?: string;
  trackingNumber: string | null;
  labelUrl?: string | null;
  trackingStatus?: string | null;
  status?: string | null;
};

export type BuyerStoreOrder = {
  id: string;
  sellerId?: string;
  orderNumber?: string;
  totalCents: number;
  shippingCostCents?: number;
  subtotalCents?: number;
  taxCents?: number;
  status: string;
  shippingAddress?: unknown;
  localDeliveryDetails?: Record<string, unknown> | null;
  createdAt: string;
  refundRequestedAt?: string | null;
  refundReason?: string | null;
  storeReturn?: {
    id?: string;
    status: string;
    reason?: string | null;
    declineReason?: string | null;
    chargeReturnShipping?: boolean;
    returnLabelCostCents?: number | null;
    refundAmountCents?: number | null;
  } | null;
  returnShipment?: BuyerShipment | null;
  cancelReason?: string | null;
  cancelNote?: string | null;
  isCashOrder?: boolean;
  pickupSellerConfirmedAt?: string | null;
  pickupBuyerConfirmedAt?: string | null;
  deliveryConfirmedAt?: string | null;
  deliveryBuyerConfirmedAt?: string | null;
  seller?: {
    id?: string;
    firstName: string;
    lastName: string;
    businesses: { name: string; slug: string }[];
  };
  items: BuyerOrderItem[];
  shipment: BuyerShipment | null;
};

export function formatBuyerPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Amount the buyer paid. Stored `totalCents` is pre-tax. */
export function buyerOrderGrandTotalCents(order: {
  totalCents: number;
  taxCents?: number | null;
}): number {
  return Math.max(0, order.totalCents + (order.taxCents ?? 0));
}

export function formatBuyerOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function buyerSellerName(order: BuyerStoreOrder): string {
  const fromBusiness = order.seller?.businesses?.[0]?.name?.trim();
  if (fromBusiness) return fromBusiness;
  const fromPerson = `${order.seller?.firstName ?? ""} ${order.seller?.lastName ?? ""}`.trim();
  return fromPerson || "Seller";
}

export function buyerSellerId(order: BuyerStoreOrder): string | undefined {
  return order.sellerId ?? order.seller?.id;
}

export function buyerShopSlug(order: BuyerStoreOrder): string | undefined {
  return order.seller?.businesses?.[0]?.slug;
}

export function buyerItemTitle(item: BuyerOrderItem): string {
  const title = item.storeItem?.title?.trim();
  return title || "Item no longer available";
}

export function buyerOrderTitle(order: BuyerStoreOrder): string {
  const items = order.items ?? [];
  if (items.length === 0) return "Item no longer available";
  return items.map(buyerItemTitle).join(" · ");
}

export function buyerItemPhoto(item: BuyerOrderItem | undefined): string | undefined {
  const photo = item?.storeItem?.photos?.find((p) => typeof p === "string" && p.trim().length > 0);
  return photo?.trim();
}

export function buyerCoverPhoto(order: BuyerStoreOrder): string | undefined {
  for (const item of order.items ?? []) {
    const photo = buyerItemPhoto(item);
    if (photo) return photo;
  }
  return undefined;
}

export function buyerPaymentLabel(order: Pick<BuyerStoreOrder, "isCashOrder">): string {
  return order.isCashOrder ? "Cash due" : "Paid Online";
}

export function canCancelBuyerOrder(order: Pick<BuyerStoreOrder, "status">): boolean {
  return order.status === "paid";
}

export function canRequestBuyerRefund(
  order: Pick<BuyerStoreOrder, "status" | "refundRequestedAt" | "isCashOrder" | "storeReturn">
): boolean {
  if (order.isCashOrder) return false;
  if (order.status !== "shipped" && order.status !== "delivered") return false;
  const ret = order.storeReturn;
  if (ret && ["requested", "awaiting_return", "in_transit", "received", "refunded"].includes(ret.status)) {
    return false;
  }
  if (!ret && order.refundRequestedAt) return false;
  return true;
}

export function trackingStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "PRE_TRANSIT" || s === "UNKNOWN") return "Label created";
  if (s === "DELIVERED" || s.includes("DELIVERED")) return "Delivered";
  if (s === "TRANSIT") return "In transit";
  if (s.includes("RETURN")) return "Returned";
  if (s.includes("FAIL")) return "Delivery issue";
  return null;
}

export function buyerTrackingHref(shipment: BuyerShipment | null | undefined): string | null {
  const tracking = shipment?.trackingNumber?.trim();
  if (!tracking) return null;
  return getTrackingUrl(shipment?.carrier ?? "", tracking);
}

export function buyerFulfillmentHeadline(order: BuyerStoreOrder): string {
  if (order.status === "canceled") return "Canceled";
  if (order.status === "refunded") return "Refunded";
  if (order.status === "delivered") return "Delivered";

  const items = order.items ?? [];
  const hasPickup = orderHasPickupLine(items);
  const hasLocal = orderHasLocalDeliveryLine(items);
  const hasShip = items.length === 0 ? true : orderHasShippedLine(items);

  if (hasPickup && !(order.pickupSellerConfirmedAt && order.pickupBuyerConfirmedAt)) {
    if (order.pickupBuyerConfirmedAt) return "Waiting for seller to confirm pickup";
    if (order.pickupSellerConfirmedAt) return "Mark pickup received";
    return "Local pickup";
  }
  if (hasLocal && !(order.deliveryConfirmedAt && order.deliveryBuyerConfirmedAt)) {
    if (order.deliveryBuyerConfirmedAt) return "Waiting for seller to confirm delivery";
    if (order.deliveryConfirmedAt) return "Mark delivery received";
    return "Local delivery";
  }

  const shippedLabel = trackingStatusLabel(order.shipment?.trackingStatus);
  if (order.shipment?.trackingNumber) {
    return shippedLabel ?? "Shipped";
  }
  if (hasShip && order.status === "paid") return "Awaiting shipment";
  if (order.status === "shipped") return "Shipped";
  return getOrderStatusLabel(order.status);
}

export function orderMatchesBuyerTab(order: BuyerStoreOrder, tab: BuyerOrderTab): boolean {
  if (tab === "to_receive") return order.status === "paid" || order.status === "shipped";
  if (tab === "delivered") return order.status === "delivered";
  if (tab === "canceled") return order.status === "canceled" || order.status === "refunded";
  return order.status !== "pending";
}

export function partitionBuyerOrders(orders: BuyerStoreOrder[]): Record<BuyerOrderTab, BuyerStoreOrder[]> {
  return {
    to_receive: orders.filter((o) => orderMatchesBuyerTab(o, "to_receive")),
    delivered: orders.filter((o) => orderMatchesBuyerTab(o, "delivered")),
    canceled: orders.filter((o) => orderMatchesBuyerTab(o, "canceled")),
    all: orders.filter((o) => orderMatchesBuyerTab(o, "all")),
  };
}

export function fulfillmentName(details: Record<string, unknown> | null | undefined): string {
  const fn = String(details?.firstName ?? "").trim();
  const ln = String(details?.lastName ?? "").trim();
  return [fn, ln].filter(Boolean).join(" ") || "Customer";
}

export function emptyBuyerTabCopy(tab: BuyerOrderTab): { title: string; body: string } {
  if (tab === "to_receive") {
    return {
      title: "Nothing to receive",
      body: "Orders you’re waiting on will show up here after you check out.",
    };
  }
  if (tab === "delivered") {
    return { title: "No delivered orders", body: "When an order arrives, it will move here." };
  }
  if (tab === "canceled") {
    return {
      title: "No canceled orders",
      body: "Canceled and refunded orders will appear in this tab.",
    };
  }
  return { title: "No orders yet", body: "When you buy from a local seller, your orders will live here." };
}
