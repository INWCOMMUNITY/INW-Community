import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey?.startsWith("sk_") || stripeSecretKey.includes("...")) {
    return NextResponse.json(
      {
        error:
          "Stripe is not configured. Replace STRIPE_SECRET_KEY in apps/main/.env with your secret key from https://dashboard.stripe.com/apikeys (use the key that starts with sk_test_ or sk_live_).",
      },
      { status: 503 }
    );
  }
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-11-20.acacia" as "2023-10-16",
  });

  let body: {
    items: { storeItemId: string; quantity: number; variant?: unknown; fulfillmentType?: string }[];
    shippingCostCents?: number;
    shippingAddress?: { street: string; aptOrSuite?: string; city: string; state: string; zip: string };
    localDeliveryDetails?: {
      firstName: string;
      lastName: string;
      phone: string;
      deliveryAddress: { street?: string; city?: string; state?: string; zip?: string };
      note?: string;
      termsAcceptedAt?: string;
    };
    cashOrderIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { items, shippingCostCents = 0, shippingAddress, localDeliveryDetails, cashOrderIds } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "At least one item required" }, { status: 400 });
  }

  const hasShippedItem = items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  if (hasShippedItem) {
    if (
      !shippingAddress ||
      !shippingAddress.street?.trim() ||
      !shippingAddress.city?.trim() ||
      !shippingAddress.state?.trim() ||
      !shippingAddress.zip?.trim()
    ) {
      return NextResponse.json(
        { error: "Shipping address is required (street, city, state, zip)." },
        { status: 400 }
      );
    }
  }

  const hasLocalDelivery = items.some((i) => i.fulfillmentType === "local_delivery");
  if (hasLocalDelivery) {
    if (
      !localDeliveryDetails ||
      !localDeliveryDetails.firstName?.trim() ||
      !localDeliveryDetails.lastName?.trim() ||
      !localDeliveryDetails.phone?.trim() ||
      !localDeliveryDetails.deliveryAddress ||
      !localDeliveryDetails.deliveryAddress.street?.trim() ||
      !localDeliveryDetails.deliveryAddress.city?.trim() ||
      !localDeliveryDetails.deliveryAddress.state?.trim() ||
      !localDeliveryDetails.deliveryAddress.zip?.trim()
    ) {
      return NextResponse.json(
        { error: "Local Delivery requires complete delivery details (name, phone, full address)." },
        { status: 400 }
      );
    }
  }

  const storeItems = await prisma.storeItem.findMany({
    where: { id: { in: items.map((i) => i.storeItemId) }, status: "active" },
  });

  if (storeItems.length !== items.length) {
    return NextResponse.json({ error: "Invalid or unavailable items" }, { status: 400 });
  }

  const itemMap = new Map(storeItems.map((s) => [s.id, s]));
  const bySeller = new Map<string, typeof items>();
  for (const item of items) {
    const storeItem = itemMap.get(item.storeItemId);
    if (!storeItem || item.quantity < 1 || item.quantity > storeItem.quantity) {
      return NextResponse.json({ error: `Invalid quantity for ${storeItem?.title ?? "item"}` }, { status: 400 });
    }
    const sellerId = storeItem.memberId;
    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId)!.push(item);
  }

  const orderIds: string[] = [];
  const summaryItems: { name: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[] = [];
  let shippingAssigned = false;
  let grandTotalCents = 0;

  for (const [sellerId, sellerItems] of bySeller) {
    let subtotalCents = 0;
    let localDeliveryFeeCentsTotal = 0;
    const orderItems: {
      storeItemId: string;
      quantity: number;
      priceCentsAtPurchase: number;
      variant?: unknown;
      fulfillmentType?: string;
    }[] = [];
    const hasShippedInThisOrder = sellerItems.some((i) => (i.fulfillmentType ?? "ship") === "ship");

    for (const item of sellerItems) {
      const storeItem = itemMap.get(item.storeItemId)!;
      const priceCents = storeItem.priceCents;
      const lineTotal = priceCents * item.quantity;
      subtotalCents += lineTotal;
      const fulfillmentType = item.fulfillmentType ?? "ship";
      if (fulfillmentType === "local_delivery" && storeItem.localDeliveryFeeCents != null && storeItem.localDeliveryFeeCents > 0) {
        localDeliveryFeeCentsTotal += storeItem.localDeliveryFeeCents * item.quantity;
      }
      const fulfillmentLabel =
        fulfillmentType === "local_delivery" ? "Local delivery" : fulfillmentType === "pickup" ? "Pickup" : "Shipping";
      summaryItems.push({
        name: `${storeItem.title} (${fulfillmentLabel})`,
        quantity: item.quantity,
        unitPriceCents: priceCents,
        lineTotalCents: lineTotal,
      });
      orderItems.push({
        storeItemId: storeItem.id,
        quantity: item.quantity,
        priceCentsAtPurchase: priceCents,
        variant: item.variant ?? undefined,
        fulfillmentType,
      });
    }

    const orderShippingCents = hasShippedInThisOrder && !shippingAssigned ? shippingCostCents : 0;
    if (orderShippingCents > 0) {
      shippingAssigned = true;
      summaryItems.push({
        name: "Shipping",
        quantity: 1,
        unitPriceCents: orderShippingCents,
        lineTotalCents: orderShippingCents,
      });
    }
    if (localDeliveryFeeCentsTotal > 0) {
      summaryItems.push({
        name: "Local Delivery",
        quantity: 1,
        unitPriceCents: localDeliveryFeeCentsTotal,
        lineTotalCents: localDeliveryFeeCentsTotal,
      });
    }

    const totalCents = subtotalCents + orderShippingCents + localDeliveryFeeCentsTotal;
    grandTotalCents += totalCents;

    const order = await prisma.storeOrder.create({
      data: {
        buyerId: session.user.id,
        sellerId,
        subtotalCents,
        shippingCostCents: orderShippingCents,
        totalCents,
        status: "pending",
        shippingAddress: shippingAddress ? (shippingAddress as object) : Prisma.JsonNull,
        localDeliveryDetails: localDeliveryDetails && hasLocalDelivery ? (localDeliveryDetails as object) : Prisma.JsonNull,
      },
    });
    orderIds.push(order.id);

    for (const oi of orderItems) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          storeItemId: oi.storeItemId,
          quantity: oi.quantity,
          priceCentsAtPurchase: oi.priceCentsAtPurchase,
          variant: oi.variant == null ? Prisma.JsonNull : (oi.variant as object),
          fulfillmentType: oi.fulfillmentType ?? null,
        },
      });
    }
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: grandTotalCents,
      currency: "usd",
      metadata: { orderIds: orderIds.join(",") },
      automatic_payment_methods: { enabled: true },
    });

    const successParams = new URLSearchParams();
    successParams.set("order_ids", orderIds.join(","));
    if (Array.isArray(cashOrderIds) && cashOrderIds.length > 0) {
      successParams.set("cash_order_ids", cashOrderIds.join(","));
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      orderIds,
      summary: {
        items: summaryItems,
        totalCents: grandTotalCents,
      },
      successUrl: `${BASE_URL}/storefront/order-success?${successParams.toString()}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}