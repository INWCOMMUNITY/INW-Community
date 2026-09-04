import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { sendTrackingEmail } from "@/lib/send-tracking-email";
import {
  normalizeLooseAddressSnapshot,
  parcelFromOrderItems,
  resolvedShipToToOrderShippingJson,
} from "@/lib/shippo-elements";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";
import {
  pickCurrentOutboundShipment,
  pickReturnShipment,
} from "@/lib/store-order-shipments";
import { isAwaitingReturnStatus } from "@/lib/store-return";
import { notifyBuyerReturnLabelReady } from "@/lib/store-return-notify";

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
    /** outbound (default) | return | replacement */
    kind?: string;
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
    weightOz: weightOzRaw,
    lengthIn: lengthInRaw,
    widthIn: widthInRaw,
    heightIn: heightInRaw,
    shipToSnapshot: shipToSnapshotRaw,
    kind: kindRaw,
  } = body;
  const requestedKind =
    kindRaw === "return" || kindRaw === "replacement" || kindRaw === "outbound"
      ? kindRaw
      : "outbound";

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
      select: {
        shippedWithOrderId: true,
        shipments: { select: { id: true, kind: true, supersededAt: true, createdAt: true } },
      },
    });
    if (row && !pickCurrentOutboundShipment(row.shipments) && row.shippedWithOrderId) {
      const primaryOk = await prisma.storeOrder.findFirst({
        where: { id: row.shippedWithOrderId, sellerId: userId },
        select: { id: true },
      });
      if (primaryOk) ids = [row.shippedWithOrderId];
    }
  }

  const primaryId = ids[0];
  // Multi-order: all paid + unshipped. Single: first label (paid, no shipment) or another label
  // (paid/shipped with shipment — never delivered; no postal labels for pickup/local-only orders).
  const statusWhere: Prisma.StoreOrderWhereInput =
    requestedKind === "return"
      ? { status: { in: ["paid", "shipped", "delivered"] } }
      : ids.length > 1
        ? { status: "paid" }
        : {
            OR: [
              { status: "paid", shipments: { none: { kind: { not: "return" }, supersededAt: null } } },
              {
                status: { in: ["paid", "shipped"] },
                shipments: { some: { kind: { not: "return" }, supersededAt: null } },
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
      shipments: true,
      storeReturns: { orderBy: { createdAt: "desc" }, take: 1 },
      items: {
        select: {
          fulfillmentType: true,
          quantity: true,
          storeItem: {
            select: {
              title: true,
              shippingOption: {
                select: { weightOz: true, lengthIn: true, widthIn: true, heightIn: true },
              },
            },
          },
        },
      },
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
  const currentOutbound = pickCurrentOutboundShipment(primaryOrder.shipments);
  const isAnotherLabel = requestedKind !== "return" && !!currentOutbound;
  const shipmentKind =
    requestedKind === "return" ? "return" : isAnotherLabel ? "replacement" : "outbound";
  for (const o of orders) {
    if (!orderHasShippedLine(o.items)) {
      return NextResponse.json(
        {
          error:
            "One or more orders have no items to ship by mail. Use Deliveries or pickup for those; Shippo is for postal shipments only.",
        },
        { status: 400 }
      );
    }
  }
  if (ids.length > 1) {
    const buyerEmail = primaryOrder.buyer?.email;
    const allSameBuyer = orders.every((o) => o.buyer?.email === buyerEmail);
    const noneShipped = orders.every((o) => !pickCurrentOutboundShipment(o.shipments));
    if (!allSameBuyer || !noneShipped || orders.length !== ids.length) {
      return NextResponse.json(
        { error: "All orders must be from the same buyer and not yet shipped" },
        { status: 400 }
      );
    }
  }

  let verifiedTracking = trackingNumber?.trim() ?? null;
  let verifiedLabelUrl = labelUrl?.trim() ?? null;
  let verifiedRateCents = Math.round(rateCents);
  const txId = shippoTransactionId?.trim() || null;
  if (!txId) {
    return NextResponse.json(
      { error: "Shippo transaction id is required to save a label." },
      { status: 400 }
    );
  }
  const { getSellerShippoCredential } = await import("@/lib/shippo-seller");
  const { fetchShippoTransaction } = await import("@/lib/shippo-transaction");
  const cred = await getSellerShippoCredential(userId);
  if (!cred) {
    return NextResponse.json(
      { error: "Shippo is not connected. Reconnect shipping in Seller Hub." },
      { status: 400 }
    );
  }
  const tx = await fetchShippoTransaction(cred, txId);
  if (!tx || !/success/i.test(tx.status)) {
    return NextResponse.json(
      {
        error:
          "Could not verify the Shippo label. If you were charged, tap retry save or contact support.",
      },
      { status: 502 }
    );
  }
  verifiedTracking = tx.trackingNumber ?? verifiedTracking;
  verifiedLabelUrl = tx.labelUrl ?? verifiedLabelUrl;
  if (tx.rateAmountCents != null) verifiedRateCents = tx.rateAmountCents;

  const combinedParcel = parcelFromOrderItems({
    id: primaryOrder.id,
    shippingAddress: null,
    buyer: { firstName: "", lastName: "" },
    items: orders.flatMap((o) =>
      o.items.map((item) => ({
        storeItem: { title: item.storeItem?.title ?? "Item", shippingOption: item.storeItem?.shippingOption },
        quantity: item.quantity,
        priceCentsAtPurchase: 0,
      }))
    ),
  });
  const weightOz = weightOzRaw ?? combinedParcel?.weightOz ?? DEFAULT_WEIGHT_OZ;
  const lengthIn = lengthInRaw ?? combinedParcel?.lengthIn ?? DEFAULT_LENGTH_IN;
  const widthIn = widthInRaw ?? combinedParcel?.widthIn ?? DEFAULT_WIDTH_IN;
  const heightIn = heightInRaw ?? combinedParcel?.heightIn ?? DEFAULT_HEIGHT_IN;

  const shipData = {
    carrier: carrier.trim(),
    service: service.trim(),
    trackingNumber: verifiedTracking,
    labelUrl: verifiedLabelUrl,
    labelCostCents: verifiedRateCents,
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

  if (shipmentKind === "return") {
    const activeReturn = primaryOrder.storeReturns[0];
    if (!activeReturn || !isAwaitingReturnStatus(activeReturn.status)) {
      return NextResponse.json(
        { error: "Approve the return before buying a return label." },
        { status: 400 }
      );
    }
    if (pickReturnShipment(primaryOrder.shipments) || activeReturn.returnShipmentId) {
      return NextResponse.json({ error: "A return label already exists for this order." }, { status: 400 });
    }
  }

  const shipment = await prisma.$transaction(async (tx) => {
    if (shipmentKind === "replacement" && currentOutbound) {
      await tx.shipment.update({
        where: { id: currentOutbound.id },
        data: { supersededAt: new Date() },
      });
    }

    const s = await tx.shipment.create({
      data: {
        orderId: primaryId,
        kind: shipmentKind,
        ...shipData,
      },
    });

    if (shipmentKind === "return") {
      const activeReturn = primaryOrder.storeReturns[0];
      if (activeReturn) {
        await tx.storeReturn.update({
          where: { id: activeReturn.id },
          data: {
            returnShipmentId: s.id,
            returnLabelCostCents: shipData.labelCostCents,
            status: shipData.trackingNumber ? "in_transit" : "awaiting_return",
          },
        });
      }
    } else {
      await tx.storeOrder.update({
        where: { id: primaryId },
        data: orderUpdate,
      });
      if (shipmentKind === "outbound") {
        for (let i = 1; i < ids.length; i++) {
          await tx.storeOrder.update({
            where: { id: ids[i] },
            data: { ...orderUpdate, shippedWithOrderId: primaryId },
          });
        }
      }
    }
    return s;
  });

  if (shipmentKind === "return") {
    notifyBuyerReturnLabelReady(primaryOrder.buyerId, primaryId);
  } else {
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
  }

  if (shipData.trackingNumber && shipmentKind !== "return") {
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
