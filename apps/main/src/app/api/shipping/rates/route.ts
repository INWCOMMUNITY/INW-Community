import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerEasyPostClient } from "@/lib/easypost-seller";

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
        error: "Connect your shipping account to get rates. You pay for labels with your own card.",
        code: "SHIPPING_ACCOUNT_REQUIRED",
      },
      { status: 403 }
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
      seller: {
        include: {
          businesses: { take: 1 },
        },
      },
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

  const business = order.seller.businesses?.[0];
  const fromAddress = {
    street1: business?.address ?? "123 Main St",
    city: business?.city ?? "Spokane",
    state: "WA",
    zip: "99201",
    country: "US",
    company: business?.name ?? "Seller",
    phone: business?.phone ?? "",
  };

  const toAddress: { name: string; street1: string; street2?: string; city: string; state: string; zip: string; country: string } = {
    name: `${order.buyer.firstName} ${order.buyer.lastName}`,
    street1: shippingAddr.street,
    city: shippingAddr.city,
    state: shippingAddr.state,
    zip: shippingAddr.zip,
    country: "US",
  };
  if (shippingAddr.aptOrSuite?.trim()) toAddress.street2 = shippingAddr.aptOrSuite.trim();

  function formatRate(
    r: { id: string; carrier: string; service: string; rate: string },
    shipmentId: string
  ) {
    const rateCents = Math.round(parseFloat(r.rate) * 100);
    return {
      id: r.id,
      carrier: r.carrier,
      service: r.service,
      rateCents,
      nwcFeeCents: 0,
      totalCents: rateCents,
      shipmentId,
    };
  }

  try {
    const shipment = await client.Shipment.create({
      from_address: fromAddress,
      to_address: toAddress,
      parcel: {
        length: lengthIn,
        width: widthIn,
        height: heightIn,
        weight: weightOz, // EasyPost uses ounces for US
      },
    });

    const ratesMap = new Map<string, ReturnType<typeof formatRate>>();
    (shipment.rates ?? []).forEach((r: { id: string; carrier: string; service: string; rate: string }) => {
      const key = `${r.carrier}-${r.service}`;
      if (!ratesMap.has(key)) ratesMap.set(key, formatRate(r, shipment.id));
    });

    // Always include USPS Flat Rate options
    const flatRateParcels = [
      { predefined_package: "FlatRateEnvelope" as const, weight: Math.min(weightOz, 70) },
      { predefined_package: "SmallFlatRateBox" as const, weight: Math.min(weightOz, 70) },
      { predefined_package: "MediumFlatRateBox" as const, weight: Math.min(weightOz, 70) },
      { predefined_package: "LargeFlatRateBox" as const, weight: Math.min(weightOz, 70) },
    ];
    for (const parcel of flatRateParcels) {
      try {
        const flatShipment = await client.Shipment.create({
          from_address: fromAddress,
          to_address: toAddress,
          parcel: parcel as { predefined_package: string; weight: number },
        });
        (flatShipment.rates ?? []).forEach((r: { id: string; carrier: string; service: string; rate: string }) => {
          const key = `${r.carrier}-${r.service}`;
          if (!ratesMap.has(key)) ratesMap.set(key, formatRate(r, flatShipment.id));
        });
      } catch {
        // Skip if flat rate fails (e.g. address not supported)
      }
    }

    const rates = Array.from(ratesMap.values());

    return NextResponse.json({ shipmentId: shipment.id, rates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get rates";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
