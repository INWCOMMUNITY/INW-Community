import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerEasyPostClient, buyShipmentWithRateId } from "@/lib/easypost-seller";
import { getEasyPostUserMessage } from "@/lib/easypost-errors";
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
    // Use direct POST with body { rate: { id } }; SDK buy() can send malformed body and trigger BAD_REQUEST
    const boughtShipment = await buyShipmentWithRateId(userId, easypostShipmentId, rateId);

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

    const { sendPushNotification } = await import("@/lib/send-push-notification");
    for (const o of orders) {
      sendPushNotification(o.buyerId, {
        title: "Your order shipped",
        body: trackingNumber
          ? `Track your order: ${carrier} ${trackingNumber}`
          : "Your order has been shipped.",
        data: { screen: "resale-hub/list", orderId: o.id },
      }).catch(() => {});
    }

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
  } catch (e: unknown) {
    const err = e as Record<string, unknown> & { message?: string };
    const msg =
      typeof err?.message === "string"
        ? err.message
        : e instanceof Error
          ? e.message
          : "Failed to purchase label";
    const code =
      typeof err?.code === "string"
        ? err.code
        : typeof (err?.json_body as { error?: { code?: string } } | undefined)?.error?.code === "string"
          ? (err.json_body as { error: { code: string } }).error.code
          : undefined;
    let jsonBodySafe: string | undefined;
    try {
      jsonBodySafe =
        err?.json_body != null
          ? JSON.stringify(err.json_body).slice(0, 500)
          : undefined;
    } catch {
      jsonBodySafe = undefined;
    }
    const orderAddr = (primaryOrder as { shippingAddress?: unknown }).shippingAddress;
    let fromAddr: unknown = null;
    try {
      const member = await prisma.member.findUnique({ where: { id: userId } });
      fromAddr = (member as { easypostReturnAddress?: unknown } | null)?.easypostReturnAddress ?? null;
    } catch {
      // ignore when logging from_address
    }
    const jsonBodyStr = typeof jsonBodySafe === "string" ? jsonBodySafe : err?.json_body != null ? JSON.stringify(err.json_body) : "";
    const isProviderEndShipper = jsonBodyStr.includes("ProviderEndShipper");
    const isFlatRateService =
      typeof service === "string" &&
      (service.includes("Flat Rate") || service.includes("FlatRate") || /FlatRate(Envelope|Box)/i.test(service));
    const logLine = `[shipping/label] EasyPost error | message=${msg} | code=${code ?? "none"} | orderId=${primaryId} | easypostShipmentId=${easypostShipmentId ?? "none"} | service=${service ?? "none"} | isFlatRateService=${isFlatRateService} | to_address=${typeof orderAddr === "object" && orderAddr ? JSON.stringify(orderAddr).slice(0, 200) : "none"} | from_address=${typeof fromAddr === "object" && fromAddr ? JSON.stringify(fromAddr).slice(0, 200) : "none"}${jsonBodySafe ? ` | json_body=${jsonBodySafe}` : ""}`;
    console.error(logLine);

    const userMessage =
      code === "RATE_LIMITED" || code === "RATE_LIMIT_EXCEEDED"
        ? "EasyPost is temporarily limiting requests. Please try again in a few minutes, or contact EasyPost support if this persists."
        : code === "ADDRESS.VERIFY.FAILURE"
          ? "The carrier rejected the address at purchase time (this can happen even when the address is correct). Make sure your business / ship-from address in Seller Hub matches your EasyPost return address. If both addresses are correct, try Get rates again and purchase immediately, or contact EasyPost support."
          : isProviderEndShipper
            ? "This label couldn't be purchased. Please tap Get rates again, then purchase the label. (If you had this screen open before an update, the previous rates may no longer work.)"
            : getEasyPostUserMessage(code, msg);

    const jsonBody = err?.json_body as { error?: { errors?: Array<{ field?: string; message?: string; suggestion?: string }> } } | undefined;
    const fieldErrors = jsonBody?.error?.errors;
    const payload: { error: string; code?: string; errors?: Array<{ field?: string; message?: string; suggestion?: string }> } = {
      error: userMessage,
      ...(code ? { code } : {}),
    };
    if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
      payload.errors = fieldErrors;
    }

    return NextResponse.json(payload, { status: 500 });
  }
}