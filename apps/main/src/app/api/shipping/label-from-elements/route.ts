import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { sendTrackingEmail } from "@/lib/send-tracking-email";

export const dynamic = "force-dynamic";

const DEFAULT_WEIGHT_OZ = 16;
const DEFAULT_LENGTH_IN = 12;
const DEFAULT_WIDTH_IN = 12;
const DEFAULT_HEIGHT_IN = 12;

/**
 * POST: Record a shipment after the seller purchased a label via Shippo Shipping Elements.
 * Accepts order id(s) and transaction data from LABEL_PURCHASED_SUCCESS; does not call Shippo.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  let body: {
    orderId?: string;
    orderIds?: string[];
    labelUrl?: string | null;
    trackingNumber?: string | null;
    carrier: string;
    service: string;
    rateCents: number;
    shippoTransactionId?: string | null;
    shippoOrderId?: string | null;
    weightOz?: number;
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    orderId,
    orderIds,
    labelUrl,
    trackingNumber,
    carrier,
    service,
    rateCents,
    shippoTransactionId,
    shippoOrderId,
    weightOz = DEFAULT_WEIGHT_OZ,
    lengthIn = DEFAULT_LENGTH_IN,
    widthIn = DEFAULT_WIDTH_IN,
    heightIn = DEFAULT_HEIGHT_IN,
  } = body;

  const ids = orderIds && orderIds.length > 0 ? orderIds : orderId ? [orderId] : [];
  if (ids.length === 0 || !carrier?.trim() || !service?.trim() || rateCents < 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const primaryId = ids[0];
  const orders = await prisma.storeOrder.findMany({
    where: {
      id: { in: ids },
      sellerId: userId,
      status: "paid",
    },
    include: { shipment: true, buyer: { select: { email: true } } },
  });
  if (orders.length === 0) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const primaryOrder = orders.find((o) => o.id === primaryId) ?? orders[0];
  const isAnotherLabel = !!primaryOrder.shipment;
  if (ids.length > 1) {
    const buyerEmail = primaryOrder.buyer?.email;
    const allSameBuyer = orders.every((o) => o.buyer?.email === buyerEmail);
    const noneShipped = orders.every((o) => !o.shipment);
    if (!allSameBuyer || !noneShipped || orders.length !== ids.length) {
      return NextResponse.json(
        { error: "All orders must be from the same buyer and not yet shipped" },
        { status: 400 }
      );
    }
  }

  const shipData = {
    carrier: carrier.trim(),
    service: service.trim(),
    trackingNumber: trackingNumber?.trim() ?? null,
    labelUrl: labelUrl?.trim() ?? null,
    labelCostCents: Math.round(rateCents),
    nwcFeeCents: 0,
    status: "created" as const,
    weightOz,
    lengthIn,
    widthIn,
    heightIn,
    shippoTransactionId: shippoTransactionId?.trim() ?? null,
    shippoOrderId: shippoOrderId?.trim() ?? null,
  };
  const orderUpdate = {
    status: "shipped" as const,
    packageWeightOz: weightOz,
    packageLengthIn: lengthIn,
    packageWidthIn: widthIn,
    packageHeightIn: heightIn,
  };

  const shipment = await prisma.$transaction(async (tx) => {
    let s;
    if (isAnotherLabel && primaryOrder.shipment) {
      s = await tx.shipment.update({
        where: { id: primaryOrder.shipment.id },
        data: shipData,
      });
      await tx.storeOrder.update({
        where: { id: primaryId },
        data: orderUpdate,
      });
    } else {
      s = await tx.shipment.create({
        data: {
          orderId: primaryId,
          ...shipData,
        },
      });
      await tx.storeOrder.update({
        where: { id: primaryId },
        data: orderUpdate,
      });
      for (let i = 1; i < ids.length; i++) {
        await tx.storeOrder.update({
          where: { id: ids[i] },
          data: { ...orderUpdate, shippedWithOrderId: primaryId },
        });
      }
    }
    return s;
  });

  const { sendPushNotification } = await import("@/lib/send-push-notification");
  for (const o of orders) {
    sendPushNotification(o.buyerId, {
      title: "Your order shipped",
      body:
        shipData.trackingNumber != null
          ? `Track your order: ${shipData.carrier} ${shipData.trackingNumber}`
          : "Your order has been shipped.",
      data: { screen: "resale-hub/list", orderId: o.id },
    }).catch(() => {});
  }

  if (shipData.trackingNumber) {
    const orderWithBuyer = await prisma.storeOrder.findUnique({
      where: { id: primaryId },
      include: { buyer: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (orderWithBuyer?.buyer?.email) {
      sendTrackingEmail({
        to: orderWithBuyer.buyer.email,
        buyerName: `${orderWithBuyer.buyer.firstName} ${orderWithBuyer.buyer.lastName}`,
        orderId: primaryId,
        carrier: shipData.carrier,
        service: shipData.service,
        trackingNumber: shipData.trackingNumber,
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    shipment: {
      id: shipment.id,
      labelUrl: shipData.labelUrl,
      trackingNumber: shipData.trackingNumber,
      carrier: shipData.carrier,
      service: shipData.service,
    },
  });
}
