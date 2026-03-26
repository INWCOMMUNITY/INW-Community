import { prisma } from "database";
import { awardPoints } from "@/lib/award-points";
import {
  isLocalDeliveryFullyConfirmed,
  isPickupFullyConfirmed,
} from "@/lib/store-order-fulfillment";

export function orderQualifiesForDeferredBuyerPoints(
  items: { fulfillmentType?: string | null }[]
): boolean {
  return items.some(
    (i) =>
      (i.fulfillmentType ?? "") === "pickup" ||
      (i.fulfillmentType ?? "") === "local_delivery"
  );
}

/**
 * Credits buyer points for an order when pickup and/or local delivery lines are fully confirmed.
 * No-op if order is ship-only, already released, or pointsAwarded is zero.
 */
export async function tryReleaseBuyerPointsForOrder(orderId: string): Promise<void> {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { fulfillmentType: true } },
    },
  });
  if (!order) return;
  if (order.buyerPointsReleasedAt) return;
  if (!orderQualifiesForDeferredBuyerPoints(order.items)) return;
  if (order.pointsAwarded <= 0) return;

  const hasPickup = order.items.some((i) => (i.fulfillmentType ?? "") === "pickup");
  const hasLocal = order.items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");

  if (hasPickup && !isPickupFullyConfirmed(order)) return;
  if (hasLocal && !isLocalDeliveryFullyConfirmed(order)) return;

  await awardPoints(order.buyerId, order.pointsAwarded);
  await prisma.storeOrder.update({
    where: { id: orderId },
    data: { buyerPointsReleasedAt: new Date() },
  });
}
