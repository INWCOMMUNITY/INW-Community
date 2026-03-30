import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { sendTrackingEmail } from "@/lib/send-tracking-email";
import {
  normalizeLooseAddressSnapshot,
  resolvedShipToToOrderShippingJson,
} from "@/lib/shippo-elements";

export const dynamic = "force-dynamic";

function orderSellerDisplayName(order: {
  seller: {
    firstName: string;
    lastName: string;
    businesses: { name: string }[];
  };
}): string {
  const biz = order.seller.businesses[0]?.name?.trim();
  if (biz) return biz;
  const personal = [order.seller.firstName, order.seller.lastName].filter(Boolean).join(" ").trim();
  return personal || "your seller";
}

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

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json(
      { error: "Subscribe or Seller plan required to record shipments." },
      { status: 403 }
    );
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
    /** Client snapshot of ship-to used in Shippo; persisted on the order when valid (fixes missing checkout JSON). */
    shipToSnapshot?: unknown;
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
    shipToSnapshot: shipToSnapshotRaw,
  } = body;

  const shipToNormalized = normalizeLooseAddressSnapshot(shipToSnapshotRaw);
  const shipToPersist = shipToNormalized
    ? resolvedShipToToOrderShippingJson(shipToNormalized)
    : null;

  let ids = orderIds && orderIds.length > 0 ? orderIds : orderId ? [orderId] : [];
  if (ids.length === 0 || !carrier?.trim() || !service?.trim() || rateCents < 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Combined shipment: only the primary order has a Shipment row; save must target that id.
  if (ids.length === 1) {
    const soleId = ids[0];
    const row = await prisma.storeOrder.findFirst({
      where: { id: soleId, sellerId: userId },
      select: { shippedWithOrderId: true, shipment: { select: { id: true } } },
    });
    if (row && !row.shipment && row.shippedWithOrderId) {
      const primaryOk = await prisma.storeOrder.findFirst({
        where: { id: row.shippedWithOrderId, sellerId: userId },
        select: { id: true },
      });
      if (primaryOk) ids = [row.shippedWithOrderId];
    }
  }

  const primaryId = ids[0];
  // Multi-order combine: all must still be unpaid + unshipped. Single order: allow shipped/delivered
  // when a shipment already exists so "purchase another label" / reprint save paths work.
  const statusWhere =
    ids.length > 1
      ? { status: "paid" as const }
      : {
          OR: [
            { status: "paid" as const },
            {
              status: { in: ["shipped", "delivered"] },
              shipment: { isNot: null },
            },
          ],
        };

  const orders = await prisma.storeOrder.findMany({
    where: {
      id: { in: ids },
      sellerId: userId,
      ...statusWhere,
    },
    include: {
      shipment: true,
      buyer: { select: { email: true } },
      seller: {
        select: {
          firstName: true,
          lastName: true,
          businesses: { select: { name: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
    },
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
    status:
      primaryOrder.status === "delivered"
        ? ("delivered" as const)
        : ("shipped" as const),
    packageWeightOz: weightOz,
    packageLengthIn: lengthIn,
    packageWidthIn: widthIn,
    packageHeightIn: heightIn,
    ...(shipToPersist ? { shippingAddress: shipToPersist as object } : {}),
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
      title: "Great news, it’s on the way!",
      body:
        shipData.trackingNumber != null
          ? `${shipData.carrier} tracking available here. Tap to follow your order from “${orderSellerDisplayName(o)}”!`
          : "Your seller marked this order as shipped. Tap for details.",
      data: { screen: "my-orders", orderId: o.id },
      category: "commerce",
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
