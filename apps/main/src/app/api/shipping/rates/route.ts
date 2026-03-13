import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  getSellerShippoApiKey,
  getSellerFromAddress,
  createShipment,
  type ShippoShipmentAddress,
} from "@/lib/shippo-seller";
import { getShippoUserMessage } from "@/lib/shippo-errors";

export const dynamic = "force-dynamic";

const SHIPPO_ADD_ADDRESS_URL = "https://apps.goshippo.com/";

function splitStreet1Street2(street1: string, street2: string): { street1: string; street2: string } {
  if (street2 || street1.length <= 35) return { street1, street2 };
  const unitMatch = street1.match(/\s+(Apt\.?|Suite|Ste\.?|Unit|#|Floor|Fl\.?|Bldg\.?|Building)\s*\.?\s*[\dA-Za-z#-]+$/i);
  if (!unitMatch) return { street1, street2 };
  const idx = street1.length - unitMatch[0].length;
  return {
    street1: street1.slice(0, idx).trim(),
    street2: unitMatch[0].trim(),
  };
}

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

  const apiKey = await getSellerShippoApiKey(userId);
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Connect your shipping account to get rates. You pay for labels with your own card.",
        code: "SHIPPING_ACCOUNT_REQUIRED",
      },
      { status: 403 }
    );
  }

  const fromAddress = await getSellerFromAddress(apiKey);
  if (!fromAddress) {
    return NextResponse.json(
      {
        error: `Add a return address in your Shippo account to get rates. Go to ${SHIPPO_ADD_ADDRESS_URL} to add an address.`,
        code: "SHIPPO_RETURN_ADDRESS_REQUIRED",
      },
      { status: 400 }
    );
  }

  let body: {
    orderId?: string;
    orderIds?: string[];
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

  const { orderId, orderIds, weightOz, lengthIn, widthIn, heightIn } = body;
  const ids = orderIds && orderIds.length > 0 ? orderIds : orderId ? [orderId] : [];
  if (ids.length === 0 || weightOz <= 0 || lengthIn <= 0 || widthIn <= 0 || heightIn <= 0) {
    return NextResponse.json({ error: "Invalid dimensions" }, { status: 400 });
  }

  const primaryId = ids[0];
  const orders = await prisma.storeOrder.findMany({
    where: {
      id: { in: ids },
      sellerId: userId,
      status: "paid",
      shipment: null,
      shippedWithOrderId: null,
    },
    include: {
      buyer: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (orders.length === 0) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const order = orders[0];
  if (ids.length > 1) {
    const buyerEmail = order.buyer.email;
    const allMatch = orders.every((o) => o.buyer.email === buyerEmail);
    if (!allMatch || orders.length !== ids.length) {
      return NextResponse.json({ error: "All orders must be from the same buyer" }, { status: 400 });
    }
  }

  const shippingAddr = order.shippingAddress as { street?: string; aptOrSuite?: string; city?: string; state?: string; zip?: string } | null;
  if (!shippingAddr?.street || !shippingAddr?.city || !shippingAddr?.state || !shippingAddr?.zip) {
    return NextResponse.json({ error: "Order has no shipping address" }, { status: 400 });
  }

  const toStreet2 = shippingAddr.aptOrSuite?.trim() ?? "";
  const { street1: toStreet1, street2: toStreet2Final } = splitStreet1Street2(
    shippingAddr.street.trim(),
    toStreet2
  );
  const toAddress: ShippoShipmentAddress = {
    name: `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "Recipient",
    street1: toStreet1.slice(0, 35),
    city: shippingAddr.city.trim(),
    state: shippingAddr.state.trim(),
    zip: shippingAddr.zip.trim().replace(/\D/g, "").slice(0, 10),
    country: "US",
    ...(toStreet2Final ? { street2: toStreet2Final.slice(0, 35) } : {}),
  };

  function formatRate(
    r: { object_id: string; amount?: string; provider?: string; servicelevel_name?: string; carrier?: string; service?: string },
    shipmentId: string
  ) {
    const amountStr = r.amount ?? "0";
    const rateCents = Math.round(parseFloat(amountStr) * 100);
    const carrier = r.provider ?? r.carrier ?? "Carrier";
    const service = r.servicelevel_name ?? r.service ?? "Standard";
    return {
      id: r.object_id,
      carrier,
      service,
      rateCents,
      nwcFeeCents: 0,
      totalCents: rateCents,
      shipmentId,
    };
  }

  try {
    const shipment = await createShipment(apiKey, fromAddress, toAddress, {
      length: lengthIn,
      width: widthIn,
      height: heightIn,
      weight: weightOz,
    });

    const ratesMap = new Map<string, ReturnType<typeof formatRate>>();
    (shipment.rates ?? []).forEach((r) => {
      const key = `${r.provider ?? r.carrier ?? ""}-${r.servicelevel_name ?? r.service ?? r.object_id}`;
      if (!ratesMap.has(key)) ratesMap.set(key, formatRate(r, shipment.object_id));
    });

    const rates = Array.from(ratesMap.values());
    return NextResponse.json({ shipmentId: shipment.object_id, rates });
  } catch (e) {
    const err = e as Record<string, unknown> & { message?: string };
    const msg =
      typeof err?.message === "string"
        ? err.message
        : e instanceof Error
          ? e.message
          : "Failed to get rates";
    const detail = typeof (err?.json_body as { detail?: string })?.detail === "string"
      ? (err.json_body as { detail: string }).detail
      : undefined;
    const userMessage = getShippoUserMessage(detail, msg);
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
