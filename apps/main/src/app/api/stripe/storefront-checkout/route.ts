import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getStripeCheckoutBranding } from "@/lib/stripe-branding";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const PLATFORM_FEE_PERCENT = 0.05; // 5%
const PLATFORM_FEE_MIN_CENTS = 50;

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

  // Group cart items by seller; each seller gets a separate order and their share of the payment.
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

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const orderIds: string[] = [];
  let shippingAssigned = false;

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
      subtotalCents += priceCents * item.quantity;
      const fulfillmentType = item.fulfillmentType ?? "ship";
      if (fulfillmentType === "local_delivery" && storeItem.localDeliveryFeeCents != null && storeItem.localDeliveryFeeCents > 0) {
        localDeliveryFeeCentsTotal += storeItem.localDeliveryFeeCents * item.quantity;
      }
      const fulfillmentLabel =
        fulfillmentType === "local_delivery"
          ? "Local delivery"
          : fulfillmentType === "pickup"
            ? "Pickup"
            : "Shipping";
      const fulfillmentDescription =
        fulfillmentType === "local_delivery"
          ? "Delivered to your address"
          : fulfillmentType === "pickup"
            ? "In-store pickup"
            : "Shipped to you";
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: priceCents,
          product_data: {
            name: `${storeItem.title} (${fulfillmentLabel})`,
            description: fulfillmentDescription,
            images: storeItem.photos.length > 0 ? [storeItem.photos[0]] : undefined,
          },
        },
        quantity: item.quantity,
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
    if (orderShippingCents > 0) shippingAssigned = true;
    const totalCents = subtotalCents + orderShippingCents + localDeliveryFeeCentsTotal;

    if (orderShippingCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: orderShippingCents,
          product_data: { name: "Shipping" },
        },
        quantity: 1,
      });
    }
    if (localDeliveryFeeCentsTotal > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: localDeliveryFeeCentsTotal,
          product_data: { name: "Local Delivery fee" },
        },
        quantity: 1,
      });
    }

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

  const successUrl =
    Array.isArray(cashOrderIds) && cashOrderIds.length > 0
      ? `${BASE_URL}/storefront/order-success?session_id={CHECKOUT_SESSION_ID}&cash_order_ids=${encodeURIComponent(cashOrderIds.join(","))}`
      : `${BASE_URL}/storefront/order-success?session_id={CHECKOUT_SESSION_ID}`;

  try {
    const branding = getStripeCheckoutBranding();
    const createParams = {
      mode: "payment" as const,
      line_items: lineItems,
      payment_method_types: ["card"] as const,
      success_url: successUrl,
      cancel_url: `${BASE_URL}/storefront?canceled=1`,
      metadata: { orderIds: orderIds.join(",") },
      ...(branding && { branding_settings: branding }),
    };
    const checkoutSession = await stripe.checkout.sessions.create(
      createParams as Stripe.Checkout.SessionCreateParams
    );

    return NextResponse.json({ url: checkoutSession.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
