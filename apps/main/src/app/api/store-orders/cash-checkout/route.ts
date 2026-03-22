import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { awardPoints } from "@/lib/award-points";
import { getBaseUrl } from "@/lib/get-base-url";
import { decrementOptionQuantity, getAvailableQuantity, hasOptionQuantities } from "@/lib/store-item-variants";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";

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
      deliveryAddress: { street?: string; city?: string; state?: string; zip?: string };
      note?: string;
      termsAcceptedAt?: string;
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
      { error: "Pay in cash is only available when all items are Pickup or Local Delivery." },
      { status: 400 }
    );
  }

  const hasLocalDelivery = items.some((i) => (i.fulfillmentType ?? "ship") === "local_delivery");
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
    include: { member: { select: { acceptCashForPickupDelivery: true } } },
  });

  if (storeItems.length !== items.length) {
    return NextResponse.json({ error: "Invalid or unavailable items" }, { status: 400 });
  }

  const itemMap = new Map(storeItems.map((s) => [s.id, s]));

  // Group cart items by seller (each seller gets a separate order; funds go to that seller).
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

    for (const item of sellerItems) {
      const storeItem = itemMap.get(item.storeItemId)!;
      const priceCents = storeItem.priceCents;
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
          hasLocalDelivery && localDeliveryDetails
            ? (localDeliveryDetails as object)
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

  await prisma.cartItem.deleteMany({
    where: { memberId: session.user.id },
  });

  const orderIdsParam = orderIds.join(",");
  const url = `${getBaseUrl()}/storefront/order-success?cash=1&order_ids=${encodeURIComponent(orderIdsParam)}`;
  return NextResponse.json({ orderIds, url });
}
