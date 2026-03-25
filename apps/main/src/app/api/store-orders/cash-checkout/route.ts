import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { awardPoints } from "@/lib/award-points";
import { getBaseUrl } from "@/lib/get-base-url";
import { decrementOptionQuantity, getAvailableQuantity, hasOptionQuantities } from "@/lib/store-item-variants";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import { resolvedPriceForCartLine } from "@/lib/resale-offer-cart-price";
import {
  validateLocalDeliveryDetails,
  validatePickupLine,
  validateRequestedFulfillment,
  storeItemHasLocalDeliveryPolicy,
  type LocalDeliveryDetailsJson,
} from "@/lib/pickup-delivery-checkout";
import {
  cancelPendingOrdersForSoldOutItems,
  cleanupOtherBuyersCartsForStoreItems,
} from "@/lib/post-sale-inventory-cleanup";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    items: { storeItemId: string; quantity: number; variant?: unknown; fulfillmentType?: string }[];
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { items, localDeliveryDetails } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "At least one item required" }, { status: 400 });
  }

  const allPickupOrLocal = items.every(
    (i) => (i.fulfillmentType ?? "ship") === "pickup" || (i.fulfillmentType ?? "ship") === "local_delivery"
  );
  if (!allPickupOrLocal) {
    return NextResponse.json(
      { error: "Pay in Cash is only available when all items are Pickup or Local Delivery." },
      { status: 400 }
    );
  }

  const hasLocalDelivery = items.some((i) => (i.fulfillmentType ?? "ship") === "local_delivery");

  const storeItems = await prisma.storeItem.findMany({
    where: { id: { in: items.map((i) => i.storeItemId) }, status: "active" },
    include: {
      member: {
        select: {
          acceptCashForPickupDelivery: true,
          sellerPickupPolicy: true,
          sellerLocalDeliveryPolicy: true,
        },
      },
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
  for (const item of items) {
    const storeItem = itemMap.get(item.storeItemId);
    const available = storeItem ? getAvailableQuantity(storeItem, item.variant) : 0;
    if (!storeItem || item.quantity < 1 || item.quantity > available) {
      return NextResponse.json({ error: `Invalid quantity for ${storeItem?.title ?? "item"}` }, { status: 400 });
    }
    if (storeItem.member?.acceptCashForPickupDelivery === false) {
      return NextResponse.json(
        { error: "One or more sellers do not accept cash for pickup or local delivery." },
        { status: 400 }
      );
    }
    const sellerId = storeItem.memberId;
    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId)!.push(item);
  }

  const buyerId = session.user.id;
  const paidPlanBuyer = await prisma.subscription.findFirst({
    where: prismaWhereActivePaidNwcPlan(buyerId),
  });
  const orderIds: string[] = [];
  const resaleOfferIdsToComplete = new Set<string>();
  const purchasedStoreItemIds = new Set<string>();
  const soldOutStoreItemIds = new Set<string>();

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
    const hasLocalDeliveryInThisOrder = sellerItems.some((i) => (i.fulfillmentType ?? "ship") === "local_delivery");

    for (const item of sellerItems) {
      const storeItem = itemMap.get(item.storeItemId)!;
      const cartRow = cartByStoreItem.get(item.storeItemId);
      const { unitPriceCents: priceCents, resaleOfferId } = resolvedPriceForCartLine(
        storeItem,
        cartRow,
        session.user.id
      );
      if (resaleOfferId) resaleOfferIdsToComplete.add(resaleOfferId);
      purchasedStoreItemIds.add(storeItem.id);
      subtotalCents += priceCents * item.quantity;
      const fulfillmentType = item.fulfillmentType ?? "pickup";
      if (fulfillmentType === "local_delivery" && storeItem.localDeliveryFeeCents != null && storeItem.localDeliveryFeeCents > 0) {
        localDeliveryFeeCentsTotal += storeItem.localDeliveryFeeCents * item.quantity;
      }
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

    const totalCents = subtotalCents + localDeliveryFeeCentsTotal;
    let pointsAwarded = Math.round(totalCents / 200);
    if (paidPlanBuyer) pointsAwarded *= 2;

    const order = await prisma.storeOrder.create({
      data: {
        buyerId,
        sellerId,
        subtotalCents,
        shippingCostCents: 0,
        totalCents,
        status: "paid",
        shippingAddress: Prisma.JsonNull,
        localDeliveryDetails:
          normalizedLocalDelivery && hasLocalDeliveryInThisOrder
            ? (normalizedLocalDelivery as object)
            : Prisma.JsonNull,
        pointsAwarded,
      },
    });
    orderIds.push(order.id);
    await awardPoints(buyerId, pointsAwarded);

    const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
    awardLocalBusinessProBadge(buyerId).catch(() => {});

    for (const oi of orderItems) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          storeItemId: oi.storeItemId,
          quantity: oi.quantity,
          priceCentsAtPurchase: oi.priceCentsAtPurchase,
          variant: oi.variant === undefined ? Prisma.JsonNull : (oi.variant as object),
          fulfillmentType: oi.fulfillmentType ?? null,
          pickupDetails: oi.pickupDetails ? (oi.pickupDetails as object) : Prisma.JsonNull,
        },
      });
      const storeItem = itemMap.get(oi.storeItemId)!;
      if (hasOptionQuantities(storeItem.variants) && oi.variant) {
        const res = decrementOptionQuantity(storeItem.variants, oi.variant, oi.quantity);
        if (res) {
          await prisma.storeItem.update({
            where: { id: oi.storeItemId },
            data: { variants: res.variants as object, quantity: { decrement: res.quantityDelta } },
          });
        } else {
          await prisma.storeItem.update({
            where: { id: oi.storeItemId },
            data: { quantity: { decrement: oi.quantity } },
          });
        }
      } else {
        await prisma.storeItem.update({
          where: { id: oi.storeItemId },
          data: { quantity: { decrement: oi.quantity } },
        });
      }
      const updated = await prisma.storeItem.findUnique({
        where: { id: oi.storeItemId },
        select: { quantity: true },
      });
      if (updated && updated.quantity <= 0) {
        await prisma.storeItem.update({
          where: { id: oi.storeItemId },
          data: { status: "sold_out" },
        });
        soldOutStoreItemIds.add(oi.storeItemId);
        const { deleteFeedPostsForSoldItem } = await import("@/lib/delete-posts-for-sold-item");
        deleteFeedPostsForSoldItem(oi.storeItemId).catch(() => {});
      }
    }
    const { sendPushNotification } = await import("@/lib/send-push-notification");
    sendPushNotification(sellerId, {
      title: "You sold an item",
      body: "A customer purchased from your store.",
      data: { screen: "seller-hub/orders", orderId: order.id },
    }).catch(() => {});
  }

  if (resaleOfferIdsToComplete.size > 0) {
    await prisma.resaleOffer.updateMany({
      where: { id: { in: [...resaleOfferIdsToComplete] }, status: "accepted" },
      data: { status: "completed" },
    });
  }

  await cleanupOtherBuyersCartsForStoreItems({
    winningBuyerId: buyerId,
    purchasedStoreItemIds: [...purchasedStoreItemIds],
  });

  if (soldOutStoreItemIds.size > 0) {
    const titleByItemId = new Map<string, string>();
    for (const id of soldOutStoreItemIds) {
      titleByItemId.set(id, itemMap.get(id)?.title ?? "Item");
    }
    await cancelPendingOrdersForSoldOutItems({
      soldOutStoreItemIds: [...soldOutStoreItemIds],
      excludeBuyerId: buyerId,
      titleByItemId,
    });
  }

  const purchasedIds = [...new Set(items.map((i) => i.storeItemId))];
  await prisma.cartItem.deleteMany({
    where: { memberId: session.user.id, storeItemId: { in: purchasedIds } },
  });

  const orderIdsParam = orderIds.join(",");
  const url = `${getBaseUrl()}/storefront/order-success?cash=1&order_ids=${encodeURIComponent(orderIdsParam)}`;
  return NextResponse.json({ orderIds, url });
}
