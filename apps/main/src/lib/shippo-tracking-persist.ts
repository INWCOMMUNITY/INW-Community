import { prisma } from "database";
import { isShippoTrackingDelivered } from "@/lib/shippo-transaction";
import { nextStatusAfterFulfillmentConfirmations } from "@/lib/store-order-fulfillment";

export async function persistShipmentTrackingStatus(args: {
  shipmentId?: string | null;
  trackingNumber?: string | null;
  shippoTransactionId?: string | null;
  trackingStatus: string;
}): Promise<{ updated: boolean; delivered: boolean; orderId: string | null }> {
  const trackingStatus = args.trackingStatus.trim().toUpperCase();
  if (!trackingStatus) {
    return { updated: false, delivered: false, orderId: null };
  }

  const shipment = args.shipmentId
    ? await prisma.shipment.findUnique({
        where: { id: args.shipmentId },
        include: {
          order: {
            include: { items: { select: { fulfillmentType: true } } },
          },
        },
      })
    : args.shippoTransactionId
      ? await prisma.shipment.findFirst({
          where: { shippoTransactionId: args.shippoTransactionId },
          include: {
            order: {
              include: { items: { select: { fulfillmentType: true } } },
            },
          },
        })
      : args.trackingNumber
        ? await prisma.shipment.findFirst({
            where: { trackingNumber: args.trackingNumber },
            include: {
              order: {
                include: { items: { select: { fulfillmentType: true } } },
              },
            },
          })
        : null;

  if (!shipment) {
    return { updated: false, delivered: false, orderId: null };
  }

  const delivered = isShippoTrackingDelivered(trackingStatus);
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      trackingStatus,
      ...(delivered ? { status: "delivered" } : {}),
    },
  });

  const next = nextStatusAfterFulfillmentConfirmations(
    shipment.order,
    shipment.order.items,
    { trackingStatus, status: delivered ? "delivered" : shipment.status }
  );
  if (next === "delivered" && shipment.order.status !== "delivered") {
    await prisma.storeOrder.update({
      where: { id: shipment.order.id },
      data: { status: "delivered" },
    });
  }

  return { updated: true, delivered, orderId: shipment.orderId };
}
