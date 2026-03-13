import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  getSellerEasyPostClient,
  getSellerEasyPostApiKey,
  getOrCreateSenderAddressId,
  createShipmentWithAddresses,
  createShipmentWithAddressesPredefined,
} from "@/lib/easypost-seller";
import { getEasyPostUserMessage } from "@/lib/easypost-errors";

export const dynamic = "force-dynamic";

/** Move unit from end of street1 to street2 when street1 > 35 and street2 empty (EasyPost-style). */
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
      seller: { select: { easypostReturnAddress: true } },
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
  // ProviderEndShipper requires at least one of name or company; treat empty string as missing
  const companyVal = returnAddr.company?.trim();
  const companyFinal = companyVal ? companyVal.slice(0, 64) : "Seller";
  const nameVal = returnAddr.name?.trim();
  const nameFinal = nameVal ? nameVal.slice(0, 64) : companyFinal;
  const { street1: fromStreet1, street2: fromStreet2 } = splitStreet1Street2(
    returnAddr.street1.trim(),
    returnAddr.street2?.trim() ?? ""
  );
  const fromAddress = {
    name: nameFinal,
    company: companyFinal,
    street1: fromStreet1,
    ...(fromStreet2 ? { street2: fromStreet2 } : {}),
    city: returnAddr.city.trim(),
    state: returnAddr.state.trim(),
    zip: returnAddr.zip.trim().replace(/\D/g, "").slice(0, 10),
    country: "US" as const,
    phone: "",
  };

  const toStreet2 = shippingAddr.aptOrSuite?.trim() ?? "";
  const { street1: toStreet1, street2: toStreet2Final } = splitStreet1Street2(
    shippingAddr.street.trim(),
    toStreet2
  );
  const toAddressInput = {
    name: `${order.buyer.firstName} ${order.buyer.lastName}`,
    street1: toStreet1,
    city: shippingAddr.city.trim(),
    state: shippingAddr.state.trim(),
    zip: shippingAddr.zip.trim().split("-")[0],
    country: "US" as const,
    ...(toStreet2Final ? { street2: toStreet2Final } : {}),
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

  let fromAddressId: string;
  try {
    fromAddressId = await getOrCreateSenderAddressId(apiKey, fromAddress, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to resolve sender address";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    const shipment = await createShipmentWithAddresses(apiKey, fromAddressId, toAddress, {
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

    // Always include USPS Flat Rate options (reuse same from_address id)
    const flatRateParcels: { predefined_package: string; weight: number }[] = [
      { predefined_package: "FlatRateEnvelope", weight: Math.min(weightOz, 70) },
      { predefined_package: "SmallFlatRateBox", weight: Math.min(weightOz, 70) },
      { predefined_package: "MediumFlatRateBox", weight: Math.min(weightOz, 70) },
      { predefined_package: "LargeFlatRateBox", weight: Math.min(weightOz, 70) },
    ];
    for (const parcel of flatRateParcels) {
      try {
        const flatShipment = await createShipmentWithAddressesPredefined(
          apiKey,
          fromAddressId,
          toAddress,
          parcel.predefined_package,
          parcel.weight
        );
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
    const err = e as Record<string, unknown> & { message?: string };
    const msg =
      typeof err?.message === "string"
        ? err.message
        : e instanceof Error
          ? e.message
          : "Failed to get rates";
    const code =
      typeof err?.code === "string"
        ? err.code
        : typeof (err?.json_body as { error?: { code?: string } } | undefined)?.error?.code === "string"
          ? (err.json_body as { error: { code: string } }).error.code
          : undefined;
    const userMessage =
      code === "RATE_LIMITED" || code === "RATE_LIMIT_EXCEEDED"
        ? "EasyPost is temporarily limiting requests. Please try again in a few minutes."
        : getEasyPostUserMessage(code, msg);
    const jsonBody = err?.json_body as { error?: { errors?: Array<{ field?: string; message?: string; suggestion?: string }> } } | undefined;
    const fieldErrors = jsonBody?.error?.errors;
    const payload: { error: string; code?: string; errors?: Array<{ field?: string; message?: string; suggestion?: string }> } = {
      error: userMessage,
      ...(code ? { code } : {}),
    };
    if (Array.isArray(fieldErrors) && fieldErrors.length > 0) payload.errors = fieldErrors;
    return NextResponse.json(payload, { status: 500 });
  }
}
