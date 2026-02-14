import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerEasyPostClient } from "@/lib/easypost-seller";
import { sendTrackingEmail } from "@/lib/send-tracking-email";

export const dynamic = "force-dynamic";

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

  const client = await getSellerEasyPostClient(userId);
  if (!client) {
    return NextResponse.json(
      {
        error: "Connect your shipping account to purchase labels. You pay for labels with your own card.",
        code: "SHIPPING_ACCOUNT_REQUIRED",
      },
      { status: 403 }
    );
  }

  let body: {
    orderId?: string;
    orderIds?: string[];
    easypostShipmentId: string;
    rateId: string;
    carrier: string;
    service: string;
    rateCents: number;
    weightOz: number;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    orderId,
    orderIds,
    easypostShipmentId,
    rateId,
    carrier,
    service,
    rateCents,
    weightOz,
    lengthIn,
    widthIn,
    heightIn,
  } = body;

  const ids = orderIds && orderIds.length > 0 ? orderIds : orderId ? [orderId] : [];
  if (
    ids.length === 0 ||
    !easypostShipmentId ||
    !rateId ||
    !carrier ||
    !service ||
    rateCents <= 0 ||
    weightOz <= 0 ||
    lengthIn <= 0 ||
    widthIn <= 0 ||
    heightIn <= 0
  ) {
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
  if (primaryOrder.shipment) {
    return NextResponse.json({ error: "Order already has a shipment" }, { status: 400 });
  }
  if (ids.length > 1) {
    const buyerEmail = primaryOrder.buyer?.email;
    const allSameBuyer = orders.every((o) => o.buyer?.email === buyerEmail);
    const noneShipped = orders.every((o) => !o.shipment);
    if (!allSameBuyer || !noneShipped || orders.length !== ids.length) {
      return NextResponse.json({ error: "All orders must be from the same buyer and not yet shipped" }, { status: 400 });
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boughtShipment = await client.Shipment.buy(easypostShipmentId, { id: rateId } as any);

    const postageLabel = boughtShipment.postage_label as { label_url?: string } | undefined;
    const labelUrl = postageLabel?.label_url ?? null;
    const trackingNumber = boughtShipment.tracking_code ?? null;

    const shipment = await prisma.$transaction(async (tx) => {
      const s = await tx.shipment.create({
        data: {
          orderId: primaryId,
          carrier,
          service,
          trackingNumber,
          labelUrl,
          labelCostCents: rateCents,
          nwcFeeCents: 0,
          status: "created",
          weightOz,
          lengthIn,
          widthIn,
          heightIn,
          easypostShipmentId: boughtShipment.id,
        },
      });
      const shipData = {
        status: "shipped" as const,
        packageWeightOz: weightOz,
        packageLengthIn: lengthIn,
        packageWidthIn: widthIn,
        packageHeightIn: heightIn,
      };
      await tx.storeOrder.update({
        where: { id: primaryId },
        data: shipData,
      });
      for (let i = 1; i < ids.length; i++) {
        await tx.storeOrder.update({
          where: { id: ids[i] },
          data: { ...shipData, shippedWithOrderId: primaryId },
        });
      }
      return s;
    });

    if (trackingNumber) {
      const orderWithBuyer = await prisma.storeOrder.findUnique({
        where: { id: primaryId },
        include: { buyer: { select: { firstName: true, lastName: true, email: true } } },
      });
      if (orderWithBuyer?.buyer?.email) {
        sendTrackingEmail({
          to: orderWithBuyer.buyer.email,
          buyerName: `${orderWithBuyer.buyer.firstName} ${orderWithBuyer.buyer.lastName}`,
          orderId: primaryId,
          carrier,
          service,
          trackingNumber,
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      ok: true,
      shipment: {
        id: shipment.id,
        labelUrl,
        trackingNumber,
        carrier,
        service,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to purchase label";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
