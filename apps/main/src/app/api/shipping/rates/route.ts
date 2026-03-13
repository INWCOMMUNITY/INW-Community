import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  getSellerEasyPostClient,
  getSellerEasyPostApiKey,
  createShipmentWithAddresses,
} from "@/lib/easypost-seller";

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

  const [client, apiKey] = await Promise.all([
    getSellerEasyPostClient(userId),
    getSellerEasyPostApiKey(userId),
  ]);
  if (!client || !apiKey) {
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

  const returnAddr = (order.seller as {
    easypostReturnAddress?: {
      street1?: string;
      street2?: string;
      city?: string;
      state?: string;
      zip?: string;
      company?: string;
      name?: string;
    } | null;
  }).easypostReturnAddress;
  if (!returnAddr?.street1?.trim() || !returnAddr?.city?.trim() || !returnAddr?.state?.trim() || !returnAddr?.zip?.trim()) {
    return NextResponse.json(
      {
        error: "Set your EasyPost return address in Seller Hub (shipping setup) first. It should match the return address in your EasyPost account and is used only for labels and packing slips.",
        code: "EASYPOST_RETURN_ADDRESS_REQUIRED",
      },
      { status: 400 }
    );
  }
  const companyVal = returnAddr.company?.trim()?.slice(0, 64) ?? "Seller";
  const fromAddress = {
    name: returnAddr.name?.trim()?.slice(0, 64) ?? companyVal ?? "Seller",
    company: companyVal,
    street1: returnAddr.street1.trim(),
    ...(returnAddr.street2?.trim() ? { street2: returnAddr.street2.trim() } : {}),
    city: returnAddr.city.trim(),
    state: returnAddr.state.trim(),
    zip: returnAddr.zip.trim().replace(/\D/g, "").slice(0, 10),
    country: "US" as const,
    phone: "",
  };

  const toAddressInput = {
    name: `${order.buyer.firstName} ${order.buyer.lastName}`,
    street1: shippingAddr.street.trim(),
    city: shippingAddr.city.trim(),
    state: shippingAddr.state.trim(),
    zip: shippingAddr.zip.trim().split("-")[0],
    country: "US" as const,
    ...(shippingAddr.aptOrSuite?.trim() ? { street2: shippingAddr.aptOrSuite.trim() } : {}),
  };

  let toAddress: { name: string; street1: string; street2?: string; city: string; state: string; zip: string; country: string };
  try {
    const verified = await client.Address.create({
      street1: toAddressInput.street1,
      street2: toAddressInput.street2,
      city: toAddressInput.city,
      state: toAddressInput.state,
      zip: toAddressInput.zip,
      country: toAddressInput.country,
      verify_strict: true,
    });
    const v = verified as { street1?: string; street2?: string; city?: string; state?: string; zip?: string };
    toAddress = {
      name: toAddressInput.name,
      street1: v.street1 ?? toAddressInput.street1,
      city: v.city ?? toAddressInput.city,
      state: v.state ?? toAddressInput.state,
      zip: (v.zip ?? toAddressInput.zip).toString().split("-")[0],
      country: "US",
    };
    if (v.street2?.trim()) toAddress.street2 = v.street2.trim();
  } catch (addrErr) {
    const msg = addrErr instanceof Error ? addrErr.message : "Address verification failed";
    console.error("[shipping/rates] address verify failed", msg);
    return NextResponse.json(
      {
        error:
          "The delivery address could not be verified by the carrier. Please ask the buyer to confirm or correct street, city, state, and ZIP (e.g. add apartment number if missing), then try again.",
        code: "ADDRESS_VERIFY_FAILED",
      },
      { status: 400 }
    );
  }

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
    const shipment = await createShipmentWithAddresses(apiKey, fromAddress, toAddress, {
      length: lengthIn,
      width: widthIn,
      height: heightIn,
      weight: weightOz, // EasyPost uses ounces for US
    });

    const ratesMap = new Map<string, ReturnType<typeof formatRate>>();
    (shipment.rates ?? []).forEach((r: { id: string; carrier: string; service: string; rate: string }) => {
      const key = `${r.carrier}-${r.service}`;
      if (!ratesMap.has(key)) ratesMap.set(key, formatRate(r, shipment.id));
    });

    // Always include USPS Flat Rate options (SDK used for predefined parcel shape)
    const flatRateParcels = [
      { predefined_package: "FlatRateEnvelope" as const, weight: Math.min(weightOz, 70) },
      { predefined_package: "SmallFlatRateBox" as const, weight: Math.min(weightOz, 70) },
      { predefined_package: "MediumFlatRateBox" as const, weight: Math.min(weightOz, 70) },
      { predefined_package: "LargeFlatRateBox" as const, weight: Math.min(weightOz, 70) },
    ];
    for (const parcel of flatRateParcels) {
      try {
        const flatShipment = await client.Shipment.create({
          from_address: {
            name: fromAddress.name,
            company: fromAddress.company,
            street1: fromAddress.street1,
            ...(fromAddress.street2 ? { street2: fromAddress.street2 } : {}),
            city: fromAddress.city,
            state: fromAddress.state,
            zip: fromAddress.zip,
            country: fromAddress.country,
            phone: fromAddress.phone ?? "",
          },
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
