export {
  filterOrdersForDeliveryTab,
  filterOrdersForPickupTab,
  formatSellerOrderTotal,
  getTrackingUrl,
  isOrderEligibleForToShipQueue,
  orderFulfillmentBadge,
  orderHasLocalDeliveryLine,
  orderHasPickupLine,
  orderHasShippedLine,
  sellerOrderPaymentLabel,
  type FulfillmentTabKey,
  type OrderLineItemSummary,
  type StoreOrderSummary,
} from "types";

import { orderHasShippedLine } from "types";
import { isShippoTrackingDelivered } from "@/lib/shippo-tracking-status";

export function orderPaymentLabel(order: { stripePaymentIntentId?: string | null }): "Paid Online" | "Cash due" {
  return order.stripePaymentIntentId ? "Paid Online" : "Cash due";
}

export function isPickupFullyConfirmed(order: {
  pickupSellerConfirmedAt?: Date | null;
  pickupBuyerConfirmedAt?: Date | null;
}): boolean {
  return !!(order.pickupSellerConfirmedAt && order.pickupBuyerConfirmedAt);
}

export function isLocalDeliveryFullyConfirmed(order: {
  deliveryConfirmedAt?: Date | null;
  deliveryBuyerConfirmedAt?: Date | null;
}): boolean {
  return !!(order.deliveryConfirmedAt && order.deliveryBuyerConfirmedAt);
}

export function isShipFulfillmentComplete(shipment?: {
  trackingStatus?: string | null;
  status?: string | null;
} | null): boolean {
  if (!shipment) return false;
  if (shipment.status === "delivered") return true;
  return isShippoTrackingDelivered(shipment.trackingStatus);
}

/**
 * Order is delivered only when every present fulfillment type is complete:
 * mail ship (tracking delivered), pickup confirmations, local delivery confirmations.
 * Mixed carts no longer leave pickup open forever because a ship line exists.
 */
export function nextStatusAfterFulfillmentConfirmations(
  order: {
    status: string;
    pickupSellerConfirmedAt?: Date | null;
    pickupBuyerConfirmedAt?: Date | null;
    deliveryConfirmedAt?: Date | null;
    deliveryBuyerConfirmedAt?: Date | null;
  },
  items: { fulfillmentType?: string | null }[],
  shipment?: { trackingStatus?: string | null; status?: string | null } | null
): string | undefined {
  if (order.status !== "paid" && order.status !== "shipped") {
    return undefined;
  }
  const hasPickup = items.some((i) => (i.fulfillmentType ?? "") === "pickup");
  const hasLocal = items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");
  const hasShip = orderHasShippedLine(items);
  if (!hasPickup && !hasLocal && !hasShip) {
    return undefined;
  }
  if (hasShip && !isShipFulfillmentComplete(shipment)) {
    return undefined;
  }
  if (hasPickup && !isPickupFullyConfirmed(order)) {
    return undefined;
  }
  if (hasLocal && !isLocalDeliveryFullyConfirmed(order)) {
    return undefined;
  }
  return "delivered";
}
