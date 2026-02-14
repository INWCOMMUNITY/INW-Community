import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

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
    const canceled = searchParams.get("canceled") === "1";

    if (buyer === "1") {
      const orders = await prisma.storeOrder.findMany({
        where: { buyerId: userId },
        include: {
          seller: {
            include: {
              businesses: { take: 1, select: { name: true, slug: true } },
            },
          },
          items: {
            include: {
              storeItem: { select: { id: true, title: true, slug: true, photos: true } },
            },
          },
          shipment: true,
        },
        orderBy: { createdAt: "desc" },
      });
      const ordersWithShipment = await Promise.all(
        orders.map(async (o) => {
          if (o.shipment) return o;
          if (o.shippedWithOrderId) {
            const primaryOrder = await prisma.storeOrder.findUnique({
              where: { id: o.shippedWithOrderId },
              include: { shipment: true },
            });
            return { ...o, shipment: primaryOrder?.shipment ?? null };
          }
          return o;
        })
      );
      return NextResponse.json(
        ordersWithShipment.map((o) => {
          const { stripePaymentIntentId, ...rest } = o;
          return { ...rest, isCashOrder: !stripePaymentIntentId };
        })
      );
    }

    if (mine === "1") {
      const sub = await prisma.subscription.findFirst({
        where: { memberId: userId, plan: "seller", status: "active" },
      });
      if (!sub) {
        return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
      }
      const where: { sellerId: string; status?: string } = { sellerId: userId };
      if (needsShipment) {
        where.status = "paid";
      }
      if (canceled) {
        where.status = "canceled";
      }
      const orders = await prisma.storeOrder.findMany({
        where,
        include: {
          buyer: { select: { id: true, firstName: true, lastName: true, email: true } },
          items: {
            include: {
              storeItem: { select: { id: true, title: true, slug: true, photos: true, description: true } },
            },
          },
          shipment: true,
        },
        orderBy: { createdAt: "desc" },
      });
      const filtered = needsShipment
        ? orders.filter((o) => o.status === "paid" && !o.shipment && !o.shippedWithOrderId)
        : orders;
      return NextResponse.json(filtered);
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}
