/**
 * Legacy: creates PaymentIntents on each seller's Stripe Connect account (no platform-level Stripe Tax).
 * Prefer `POST /api/stripe/storefront-checkout` for hosted Checkout on the platform; webhook sends Connect transfers.
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { resolveAllowedCheckoutBaseUrl } from "@/lib/checkout-base-url";
import { getAvailableQuantity } from "@/lib/store-item-variants";
import { resolvedPriceForCartLine } from "@/lib/resale-offer-cart-price";
import {
  validateLocalDeliveryDetails,
  validatePickupLine,
  validateRequestedFulfillment,
  storeItemHasLocalDeliveryPolicy,
  type LocalDeliveryDetailsJson,
} from "@/lib/pickup-delivery-checkout";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    // Diagnostic (dev only): confirm whether failure is missing cookie vs NextAuth returning null
    if (process.env.NODE_ENV === "development") {
      const hasBearer = req.headers.get("authorization")?.startsWith("Bearer ") ?? false;
      const nextAuthCookie =
        req.cookies.get("__Secure-next-auth.session-token") ?? req.cookies.get("next-auth.session-token");
      console.warn("[storefront-checkout-intent] session null", {
        hasBearer,
        hasNextAuthCookie: Boolean(nextAuthCookie),
      });
    }
    return NextResponse.json(
      { error: "Session expired. Please sign in again." },
      { status: 401 }
    );
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
    /** Client can pass current origin so success redirect matches (e.g. window.location.origin or app WebView base). */
    returnBaseUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { items, shippingCostCents = 0, shippingAddress, localDeliveryDetails, cashOrderIds, returnBaseUrl } = body;
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

  // Cancel older pending orders for this buyer to avoid duplicates when they tap Checkout
  // multiple times (e.g. retry after cancel or session expired). Leave orders created in the
  // last 60s so a double-tap doesn't cancel the first request's orders before the client uses them.
  const cancelPendingOlderThan = new Date(Date.now() - 60 * 1000);
  await prisma.storeOrder.updateMany({
    where: {
      buyerId: session.user.id,
      status: "pending",
      createdAt: { lt: cancelPendingOlderThan },
    },
    data: { status: "canceled" },
  });

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

  const bySeller = new Map<string, typeof items>();
  const singleQtyStoreItemIds: string[] = [];
  for (const item of items) {
    const storeItem = itemMap.get(item.storeItemId);
    const available = storeItem ? getAvailableQuantity(storeItem, item.variant) : 0;
    if (!storeItem || item.quantity < 1 || item.quantity > available) {
      return NextResponse.json({ error: `Invalid quantity for ${storeItem?.title ?? "item"}` }, { status: 400 });
    }
    if (available === 1) {
      singleQtyStoreItemIds.push(item.storeItemId);
    }
    const sellerId = storeItem.memberId;
    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId)!.push(item);
  }

  // Reject only if the item is in another customer's pending order (they started checkout).
  // We do not block when the item is only in someone's cart—carts have no order until checkout is started.
  if (singleQtyStoreItemIds.length > 0) {
    const pendingCutoff = new Date(Date.now() - 25 * 60 * 1000);
    const otherPending = await prisma.orderItem.findFirst({
      where: {
        storeItemId: { in: singleQtyStoreItemIds },
        order: {
          status: "pending",
          buyerId: { not: session.user.id },
          createdAt: { gte: pendingCutoff },
        },
      },
      include: { order: { select: { buyerId: true } } },
    });
    if (otherPending) {
      const storeItem = itemMap.get(otherPending.storeItemId);
      const title = storeItem?.title ?? "This item";
      return NextResponse.json(
        { error: `${title} is currently in another customer's checkout.` },
        { status: 400 }
      );
    }
  }

  // Validate all sellers have Stripe Connect before creating any orders (avoid orphan pending orders)
  const sellerIdsForConnect = [...bySeller.keys()];
  const membersForConnect = await prisma.member.findMany({
    where: { id: { in: sellerIdsForConnect } },
    select: { id: true, stripeConnectAccountId: true },
  });
  const connectMap = new Map(membersForConnect.map((m) => [m.id, m.stripeConnectAccountId]));
  for (const sid of sellerIdsForConnect) {
    if (!connectMap.get(sid)?.trim()) {
      return NextResponse.json(
        { error: "Seller payment account is not set up. Items from that seller cannot be purchased until they complete payment setup." },
        { status: 400 }
      );
    }
  }

  const sellerOrderPairs: { sellerId: string; orderId: string; totalCents: number }[] = [];
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
      const lineTotal = priceCents * item.quantity;
      subtotalCents += lineTotal;
      const fulfillmentType = item.fulfillmentType ?? "ship";
      if (fulfillmentType === "local_delivery" && storeItem.localDeliveryFeeCents != null && storeItem.localDeliveryFeeCents > 0) {
        localDeliveryFeeCentsTotal += storeItem.localDeliveryFeeCents * item.quantity;
      }
      const fulfillmentLabel =
        fulfillmentType === "local_delivery" ? "Local delivery" : fulfillmentType === "pickup" ? "Pickup" : "Shipping";
      summaryItems.push({
        name: `${storeItem.title} (${fulfillmentLabel})${resaleOfferId ? " — agreed offer" : ""}`,
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
        pickupDetails:
          fulfillmentType === "pickup" && cartRow?.pickupDetails
            ? (cartRow.pickupDetails as object)
            : undefined,
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
        localDeliveryDetails:
          normalizedLocalDelivery && hasLocalDeliveryInThisOrder
            ? (normalizedLocalDelivery as object)
            : Prisma.JsonNull,
      },
    });
    sellerOrderPairs.push({ sellerId, orderId: order.id, totalCents });

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

  const orderIds = sellerOrderPairs.map((p) => p.orderId);
  const resaleOfferIdsStr = [...resaleOfferIdsMeta].join(",");

  const payments: { clientSecret: string; orderIds: string[]; stripeAccountId: string; amountCents: number }[] = [];
  for (const pair of sellerOrderPairs) {
    const connectAccountId = connectMap.get(pair.sellerId);
    if (!connectAccountId?.trim()) {
      return NextResponse.json(
        { error: `Seller payment account is not set up. Please try again or contact support.` },
        { status: 400 }
      );
    }
    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: pair.totalCents,
          currency: "usd",
          metadata: {
            orderId: pair.orderId,
            ...(resaleOfferIdsStr ? { resaleOfferIds: resaleOfferIdsStr.slice(0, 450) } : {}),
          },
          payment_method_types: ["card", "link"],
        },
        { stripeAccount: connectAccountId }
      );
      if (!paymentIntent.client_secret) {
        return NextResponse.json({ error: "Failed to create payment session" }, { status: 500 });
      }
      payments.push({
        clientSecret: paymentIntent.client_secret,
        orderIds: [pair.orderId],
        stripeAccountId: connectAccountId,
        amountCents: pair.totalCents,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Checkout failed";
      const accountGone = /no such account|account.*doesn't exist|account.*does not exist|invalid id/i.test(message);
      if (accountGone) {
        await prisma.member
          .update({
            where: { id: pair.sellerId },
            data: { stripeConnectAccountId: null },
          })
          .catch(() => {});
        await prisma.storeOrder.updateMany({
          where: { id: pair.orderId },
          data: { status: "canceled" },
        }).catch(() => {});
        return NextResponse.json(
          {
            error:
              "One seller's payment account is no longer valid. They need to complete payment setup again in Seller Hub. Please remove their items from the cart or try again after they complete setup.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `Payment setup failed for one seller: ${message}` },
        { status: 400 }
      );
    }
  }

  const successParams = new URLSearchParams();
  successParams.set("order_ids", orderIds.join(","));
  if (Array.isArray(cashOrderIds) && cashOrderIds.length > 0) {
    successParams.set("cash_order_ids", cashOrderIds.join(","));
  }

  const baseForSuccess = resolveAllowedCheckoutBaseUrl(returnBaseUrl);

  return NextResponse.json({
    payments,
    orderIds,
    summary: {
      items: summaryItems,
      totalCents: grandTotalCents,
    },
    successUrl: `${baseForSuccess}/storefront/order-success?${successParams.toString()}`,
  });
}