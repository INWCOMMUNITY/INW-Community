import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { getStripeCheckoutBranding } from "@/lib/stripe-branding";
import { getAvailableQuantity } from "@/lib/store-item-variants";
import { resolvedPriceForCartLine } from "@/lib/resale-offer-cart-price";
import {
  validateLocalDeliveryDetails,
  validatePickupLine,
  validateRequestedFulfillment,
  storeItemHasLocalDeliveryPolicy,
  type LocalDeliveryDetailsJson,
} from "@/lib/pickup-delivery-checkout";
import { ensureStripeCustomerForStorefrontCheckout } from "@/lib/stripe-storefront-checkout-customer";

/**
 * Stripe Product tax code **General - Tangible Goods** (`txcd_99999999`).
 * Every Checkout line from storefront + Community Resale (merchandise, shipping, local delivery fee)
 * uses this code so Stripe Tax treats the session consistently with your Dashboard preset.
 *
 * Dynamic `price_data` still needs `tax_behavior: "exclusive"` per line — see Stripe Tax + Checkout docs.
 * Optional override: `STRIPE_TAX_CODE_GENERAL_TANGIBLE_GOODS` (or legacy `STRIPE_TAX_CODE_TANGIBLE`).
 *
 * @see https://docs.stripe.com/tax/tax-codes
 * @see https://docs.stripe.com/tax/checkout
 */
const TAX_CODE_GENERAL_TANGIBLE_GOODS =
  process.env.STRIPE_TAX_CODE_GENERAL_TANGIBLE_GOODS?.trim() ||
  process.env.STRIPE_TAX_CODE_TANGIBLE?.trim() ||
  "txcd_99999999";

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
      email?: string;
      deliveryAddress: { street?: string; city?: string; state?: string; zip?: string };
      note?: string;
      termsAcceptedAt?: string;
      availableDropOffTimes?: string;
    };
    cashOrderIds?: string[];
    /** Mobile app can pass this so redirect works on device (e.g. http://192.168.1.140:3000) */
    returnBaseUrl?: string;
    /**
     * When true with shipped line(s), skip app-provided shipping; Stripe Checkout collects shipping.
     * Used by product-page “Buy It Now”. Webhook copies `shipping_details` onto pending orders.
     */
    shippingCollectedByStripe?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    items,
    shippingCostCents = 0,
    shippingAddress,
    localDeliveryDetails,
    cashOrderIds,
    returnBaseUrl,
    shippingCollectedByStripe,
  } = body;
  const baseUrl = resolveAllowedCheckoutBaseUrl(returnBaseUrl);
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "At least one item required" }, { status: 400 });
  }

  const hasShippedItem = items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  const deferShippingToStripe = Boolean(shippingCollectedByStripe) && hasShippedItem;
  if (hasShippedItem && !deferShippingToStripe) {
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

  const storeItems = await prisma.storeItem.findMany({
    where: { id: { in: items.map((i) => i.storeItemId) }, status: "active" },
    include: {
      member: { select: { sellerPickupPolicy: true, sellerLocalDeliveryPolicy: true } },
    },
  });

  if (storeItems.length !== items.length) {
    return NextResponse.json({ error: "Invalid or unavailable items" }, { status: 400 });
  }

  const itemMap = new Map(storeItems.map((s) => [s.id, s]));

  for (const line of items) {
    const si = itemMap.get(line.storeItemId);
    if (!si) continue;
    const fv = validateRequestedFulfillment(si, line.fulfillmentType);
    if (!fv.ok) {
      return NextResponse.json({ error: fv.error }, { status: 400 });
    }
  }

  let normalizedLocalDelivery: LocalDeliveryDetailsJson | undefined;
  if (hasLocalDelivery) {
    const requireLocalPolicy = items.some(
      (i) =>
        (i.fulfillmentType ?? "ship") === "local_delivery" &&
        storeItemHasLocalDeliveryPolicy(itemMap.get(i.storeItemId)!)
    );
    const ld = validateLocalDeliveryDetails(localDeliveryDetails, {
      requirePolicyAcceptance: requireLocalPolicy,
    });
    if (!ld.ok) {
      return NextResponse.json({ error: ld.error }, { status: 400 });
    }
    normalizedLocalDelivery = ld.details;
  }

  const cartDbItems = await prisma.cartItem.findMany({
    where: {
      memberId: session.user.id,
      storeItemId: { in: items.map((i) => i.storeItemId) },
    },
    include: { resaleOffer: true },
  });
  const cartByStoreItem = new Map(cartDbItems.map((c) => [c.storeItemId, c]));
  const resaleOfferIdsMeta = new Set<string>();

  for (const item of items) {
    if ((item.fulfillmentType ?? "ship") !== "pickup") continue;
    const storeItem = itemMap.get(item.storeItemId);
    const cartRow = cartByStoreItem.get(item.storeItemId);
    if (!storeItem) continue;
    const v = validatePickupLine(cartRow, storeItem);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
  }

  // Group cart items by seller; each seller gets a separate order and their share of the payment.
  const bySeller = new Map<string, typeof items>();
  for (const item of items) {
    const storeItem = itemMap.get(item.storeItemId);
    const available = storeItem ? getAvailableQuantity(storeItem, item.variant) : 0;
    if (!storeItem || item.quantity < 1 || item.quantity > available) {
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
      pickupDetails?: object;
    }[] = [];
    const hasShippedInThisOrder = sellerItems.some((i) => (i.fulfillmentType ?? "ship") === "ship");
    const hasLocalDeliveryInThisOrder = sellerItems.some((i) => i.fulfillmentType === "local_delivery");

    for (const item of sellerItems) {
      const storeItem = itemMap.get(item.storeItemId)!;
      const cartRow = cartByStoreItem.get(item.storeItemId);
      const { unitPriceCents: priceCents, resaleOfferId } = resolvedPriceForCartLine(
        storeItem,
        cartRow,
        session.user.id
      );
      if (resaleOfferId) resaleOfferIdsMeta.add(resaleOfferId);
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
          tax_behavior: "exclusive",
          product_data: {
            name: `${storeItem.title} (${fulfillmentLabel})${resaleOfferId ? " — agreed offer price" : ""}`,
            description: fulfillmentDescription,
            images: storeItem.photos.length > 0 ? [storeItem.photos[0]] : undefined,
            tax_code: TAX_CODE_GENERAL_TANGIBLE_GOODS,
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
        pickupDetails:
          fulfillmentType === "pickup" && cartRow?.pickupDetails
            ? (cartRow.pickupDetails as object)
            : undefined,
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
          tax_behavior: "exclusive",
          product_data: {
            name: "Shipping",
            tax_code: TAX_CODE_GENERAL_TANGIBLE_GOODS,
          },
        },
        quantity: 1,
      });
    }
    if (localDeliveryFeeCentsTotal > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: localDeliveryFeeCentsTotal,
          tax_behavior: "exclusive",
          product_data: {
            name: "Local Delivery fee",
            tax_code: TAX_CODE_GENERAL_TANGIBLE_GOODS,
          },
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
        localDeliveryDetails:
          normalizedLocalDelivery && hasLocalDeliveryInThisOrder
            ? (normalizedLocalDelivery as object)
            : Prisma.JsonNull,
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
          pickupDetails: oi.pickupDetails ? (oi.pickupDetails as object) : Prisma.JsonNull,
        },
      });
    }
  }

  const successUrl =
    Array.isArray(cashOrderIds) && cashOrderIds.length > 0
      ? `${baseUrl}/storefront/order-success?session_id={CHECKOUT_SESSION_ID}&cash_order_ids=${encodeURIComponent(cashOrderIds.join(","))}`
      : `${baseUrl}/storefront/order-success?session_id={CHECKOUT_SESSION_ID}`;

  try {
    const buyerMember = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: { email: true, firstName: true, lastName: true },
    });
    if (!buyerMember) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const customerId = await ensureStripeCustomerForStorefrontCheckout(stripe, {
      memberId: session.user.id,
      email: buyerMember.email,
      firstName: buyerMember.firstName,
      lastName: buyerMember.lastName,
      shipTo:
        hasShippedItem && shippingAddress && !deferShippingToStripe ? shippingAddress : null,
    });

    const branding = getStripeCheckoutBranding();
    const orderIdsStr = orderIds.join(",");
    const METADATA_VALUE_MAX = 500;
    const metadata: Record<string, string> = {};
    const resaleStr = [...resaleOfferIdsMeta].join(",");
    if (resaleStr.length > 0 && resaleStr.length <= METADATA_VALUE_MAX) {
      metadata.resaleOfferIds = resaleStr;
    } else if (resaleStr.length > METADATA_VALUE_MAX) {
      metadata.resaleOfferIds = resaleStr.slice(0, METADATA_VALUE_MAX);
    }

    if (orderIdsStr.length <= METADATA_VALUE_MAX) {
      metadata.orderIds = orderIdsStr;
    } else {
      const parts = orderIdsStr.split(",");
      let chunk = "";
      let idx = 0;
      for (const part of parts) {
        const next = chunk ? `${chunk},${part}` : part;
        if (next.length > METADATA_VALUE_MAX && chunk) {
          metadata[`orderIds_${idx}`] = chunk;
          idx += 1;
          chunk = part;
        } else {
          chunk = next;
        }
      }
      if (chunk) metadata[`orderIds_${idx}`] = chunk;
    }
    const createParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: lineItems,
      payment_method_types: ["card"],
      success_url: successUrl,
      cancel_url: `${baseUrl}/storefront?canceled=1`,
      automatic_tax: { enabled: true },
      // Cart/checkout in-app: tax uses Customer shipping (no Stripe shipping step). Buy It Now: collect on Stripe.
      billing_address_collection: "required",
      customer: customerId,
      ...(deferShippingToStripe
        ? { shipping_address_collection: { allowed_countries: ["US"] } }
        : {}),
      metadata,
      ...(branding ? { branding_settings: branding } : {}),
    };
    const checkoutSession = await stripe.checkout.sessions.create(createParams);

    return NextResponse.json({ url: checkoutSession.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
