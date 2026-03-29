export function orderPaymentLabel(order: { stripePaymentIntentId?: string | null }): "Paid online" | "Cash due" {
  return order.stripePaymentIntentId ? "Paid online" : "Cash due";
}

export function orderHasShippedLine(items: { fulfillmentType?: string | null }[]): boolean {
  return items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
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

/**
 * When safe, set status to delivered for orders with no shipped lines once
 * pickup and/or local delivery confirmations are satisfied.
 */
export function nextStatusAfterFulfillmentConfirmations(
  order: {
    status: string;
    pickupSellerConfirmedAt?: Date | null;
    pickupBuyerConfirmedAt?: Date | null;
    deliveryConfirmedAt?: Date | null;
    deliveryBuyerConfirmedAt?: Date | null;
  },
  items: { fulfillmentType?: string | null }[]
): string | undefined {
  if (order.status !== "paid" && order.status !== "shipped") {
    return undefined;
  }
  if (orderHasShippedLine(items)) {
    return undefined;
  }
  const hasPickup = items.some((i) => (i.fulfillmentType ?? "") === "pickup");
  const hasLocal = items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");
  if (hasPickup && !isPickupFullyConfirmed(order)) {
    return undefined;
  }
  if (hasLocal && !isLocalDeliveryFullyConfirmed(order)) {
    return undefined;
  }
  if (hasPickup || hasLocal) {
    return "delivered";
  }
  return undefined;
}
