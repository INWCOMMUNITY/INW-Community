import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import { orderHasShippedLine, orderHasPickupLine, orderHasLocalDeliveryLine } from "@/lib/store-order-fulfillment";
import {
  serializeOrderShipments,
  storeOrderShipmentInclude,
} from "@/lib/store-order-shipments";
import { ACTIVE_STORE_RETURN_STATUSES } from "@/lib/store-return";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const mine = searchParams.get("mine");
    const buyer = searchParams.get("buyer");
    const needsShipment = searchParams.get("needsShipment") === "1";
    const counts = searchParams.get("counts") === "1";
    const canceled = searchParams.get("canceled") === "1";
    const shipped = searchParams.get("shipped") === "1";
    const delivered = searchParams.get("delivered") === "1";
    const returnsOnly = searchParams.get("returns") === "1";

    if (buyer === "1") {
      const buyerToReceive = searchParams.get("to_receive") === "1";
      const buyerDelivered = searchParams.get("delivered") === "1";
      const buyerCanceled = searchParams.get("canceled") === "1";
      const buyerWhere: Prisma.StoreOrderWhereInput = { buyerId: userId };
      if (buyerToReceive) buyerWhere.status = { in: ["paid", "shipped"] };
      else if (buyerDelivered) buyerWhere.status = "delivered";
      else if (buyerCanceled) buyerWhere.status = { in: ["canceled", "refunded"] };
      else buyerWhere.status = { not: "pending" };

      const orders = await prisma.storeOrder.findMany({
        where: buyerWhere,
        include: {
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              businesses: { take: 1, select: { name: true, slug: true } },
            },
          },
          items: {
            include: {
              storeItem: { select: { id: true, title: true, slug: true, photos: true, listingType: true, shippingOption: { select: { weightOz: true, lengthIn: true, widthIn: true, heightIn: true } } } },
            },
          },
          ...storeOrderShipmentInclude,
        },
        orderBy: { createdAt: "desc" },
      });
      const ordersWithShipment = await Promise.all(
        orders.map(async (o) => {
          const serialized = serializeOrderShipments(o);
          if (serialized.shipment) return serialized;
          if (o.shippedWithOrderId) {
            const primaryOrder = await prisma.storeOrder.findUnique({
              where: { id: o.shippedWithOrderId },
              include: storeOrderShipmentInclude,
            });
            const primary = primaryOrder ? serializeOrderShipments(primaryOrder) : null;
            return { ...serialized, shipment: primary?.shipment ?? null };
          }
          return serialized;
        })
      );
      return NextResponse.json(
        ordersWithShipment.map((o) => {
          const { stripePaymentIntentId, ...rest } = o;
          return {
            ...rest,
            isCashOrder: !stripePaymentIntentId,
            orderNumber: o.id.slice(-8).toUpperCase(),
          };
        })
      );
    }

    if (mine === "1") {
      const sellerSponsorOrSubscribe = await prisma.subscription.findFirst({
        where: prismaWhereActivePaidNwcPlan(userId),
      });
      if (!sellerSponsorOrSubscribe) {
        return NextResponse.json({ error: "Seller, Business, or Subscribe plan required" }, { status: 403 });
      }

      if (counts) {
        const orders = await prisma.storeOrder.findMany({
          where: { sellerId: userId },
          select: {
            status: true,
            shipments: { select: { id: true, kind: true, supersededAt: true, createdAt: true } },
            shippedWithOrderId: true,
            pickupSellerConfirmedAt: true,
            deliveryConfirmedAt: true,
            deliveryBuyerConfirmedAt: true,
            items: { select: { fulfillmentType: true } },
          },
        });

        let toShip = 0;
        let pickups = 0;
        let deliveries = 0;
        let shipped = 0;
        let canceledCount = 0;

        for (const o of orders) {
          if (o.status === "canceled" || o.status === "refunded" || o.status === "cancelled") {
            canceledCount++;
            continue;
          }
          if (o.status === "shipped") {
            shipped++;
          }
          if (
            o.status === "paid" &&
            !serializeOrderShipments(o).shipment &&
            !o.shippedWithOrderId &&
            orderHasShippedLine(o.items)
          ) {
            toShip++;
          }
          if (orderHasPickupLine(o.items) && !o.pickupSellerConfirmedAt) {
            pickups++;
          }
          if (
            orderHasLocalDeliveryLine(o.items) &&
            !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt)
          ) {
            deliveries++;
          }
        }

        return NextResponse.json({ toShip, pickups, deliveries, shipped, canceled: canceledCount });
      }

      const where: Prisma.StoreOrderWhereInput = { sellerId: userId };
      if (needsShipment) {
        where.status = "paid";
      }
      if (canceled) {
        where.status = { in: ["canceled", "refunded", "cancelled"] };
      }
      if (shipped) {
        where.status = "shipped";
      }
      if (delivered) {
        where.status = "delivered";
      }
      if (returnsOnly) {
        where.storeReturns = { some: { status: { in: [...ACTIVE_STORE_RETURN_STATUSES] } } };
      }
      const orders = await prisma.storeOrder.findMany({
        where,
        include: {
          buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
          items: {
            include: {
              storeItem: { select: { id: true, title: true, slug: true, photos: true, description: true, listingType: true, shippingOption: { select: { weightOz: true, lengthIn: true, widthIn: true, heightIn: true } } } },
            },
          },
          ...storeOrderShipmentInclude,
        },
        orderBy: { createdAt: "desc" },
      });
      const serialized = orders.map((o) => serializeOrderShipments(o));
      const filtered = needsShipment
        ? serialized.filter(
            (o) =>
              o.status === "paid" &&
              !o.shipment &&
              !o.shippedWithOrderId &&
              orderHasShippedLine(o.items)
          )
        : serialized;
      return NextResponse.json(
        filtered.map((o) => ({ ...o, orderNumber: o.id.slice(-8).toUpperCase() }))
      );
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    console.error("[store-orders GET]", e);
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}
