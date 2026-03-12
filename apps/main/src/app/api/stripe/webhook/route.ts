import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { awardPoints } from "@/lib/award-points";
import { decrementOptionQuantity, getAvailableQuantity, hasOptionQuantities } from "@/lib/store-item-variants";
import { disconnectStripeAndDisableListings } from "@/lib/stripe-connect-disconnect";

/**
 * Idempotency: Stripe may deliver the same event more than once. All handlers in this file
 * must be safe when run multiple times for the same event (e.g. check order.status === "paid"
 * and stripePaymentIntentId before updating, skip if already processed). Do not assume
 * one-to-one event-to-order updates.
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createBusinessFromMetadata(
  memberId: string,
  data: Record<string, unknown>
): Promise<void> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const shortDescription = typeof data.shortDescription === "string" ? data.shortDescription.trim() : null;
  const fullDescription = typeof data.fullDescription === "string" ? data.fullDescription.trim() : null;
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];

  if (!name || !city || categories.length === 0) return;

  const website = typeof data.website === "string" && data.website.trim()
    ? (data.website.startsWith("http") ? data.website : `https://${data.website}`)
    : null;
  const phone = typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : null;
  const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : null;
  const logoUrl = typeof data.logoUrl === "string" && data.logoUrl.trim() ? data.logoUrl.trim() : null;
  const coverPhotoUrl = typeof data.coverPhotoUrl === "string" && data.coverPhotoUrl.trim() ? data.coverPhotoUrl.trim() : null;
  const address = typeof data.address === "string" && data.address.trim() ? data.address.trim() : null;
  const photos = Array.isArray(data.photos) ? (data.photos as string[]).filter(Boolean) : [];
  const hoursOfOperation = data.hoursOfOperation && typeof data.hoursOfOperation === "object"
    ? (data.hoursOfOperation as Record<string, string>)
    : undefined;

  const existingCount = await prisma.business.count({ where: { memberId } });
  if (existingCount >= 2) return;

  let slug = slugify(name);
  let suffix = 0;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${slugify(name)}-${++suffix}`;
  }

  const business = await prisma.business.create({
    data: {
      memberId,
      name,
      shortDescription,
      fullDescription,
      website,
      phone,
      email,
      logoUrl,
      coverPhotoUrl,
      address,
      city,
      categories,
      slug,
      photos,
      hoursOfOperation,
    },
  });
  const { awardBusinessSignupBadges } = await import("@/lib/badge-award");
  awardBusinessSignupBadges(business.id).catch(() => {});
}

export async function POST(req: NextRequest) {
  // Pass raw bytes as Buffer so signature verification sees the exact payload
  // (string/blob.text() can change encoding on some platforms e.g. Vercel).
  const raw = await req.arrayBuffer();
  const body = Buffer.from(raw);
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    console.warn("[stripe/webhook] 400: missing stripe-signature header");
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const platformSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
  if (!platformSecret && !connectSecret) {
    console.warn("[stripe/webhook] 400: STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET both missing or empty");
    return NextResponse.json({ error: "Missing webhook secret(s)" }, { status: 400 });
  }

  // Tolerance (seconds) for timestamp in signature to allow for clock skew
  const toleranceSeconds = 300;
  let event: Stripe.Event;
  let lastError: unknown;
  if (platformSecret) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, platformSecret, toleranceSeconds);
    } catch (e) {
      lastError = e;
      event = null as unknown as Stripe.Event;
    }
  } else {
    lastError = new Error("No platform secret");
    event = null as unknown as Stripe.Event;
  }
  if (!event && connectSecret) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, connectSecret, toleranceSeconds);
    } catch (e) {
      lastError = e;
      event = null as unknown as Stripe.Event;
    }
  }
  if (!event) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    console.warn("[stripe/webhook] 400: invalid signature", {
      detail: msg,
      hint: "Ensure STRIPE_WEBHOOK_SECRET (and STRIPE_CONNECT_WEBHOOK_SECRET if used) match the signing secret for this endpoint in Stripe Dashboard (Developers → Webhooks), and that the request body is not modified by a proxy.",
    });
    return NextResponse.json(
      {
        error: "Invalid signature",
        hint: "In Stripe Dashboard go to Developers → Webhooks → your endpoint for this URL → Reveal 'Signing secret'. Copy that value (whsec_...) into STRIPE_WEBHOOK_SECRET in your production env. Use Live mode secret for live events, Test mode secret for test events.",
      },
      { status: 400 }
    );
  }

  // Connected account disconnected the platform; clear our link and disable their listings
  if (event.type === "account.application.deauthorized") {
    const connectAccountId = (event as Stripe.Event & { account?: string }).account;
    if (connectAccountId) {
      const member = await prisma.member.findFirst({
        where: { stripeConnectAccountId: connectAccountId },
        select: { id: true },
      });
      if (member) {
        await disconnectStripeAndDisableListings(member.id);
      }
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const memberId = session.metadata?.memberId;
    const planId = session.metadata?.planId as "subscribe" | "sponsor" | "seller" | undefined;
    const subId = session.subscription as string | null;

    if (memberId && planId && subId) {
      await prisma.subscription.create({
        data: {
          memberId,
          plan: planId,
          stripeSubscriptionId: subId,
          stripeCustomerId: session.customer as string | null,
          status: "active",
        },
      });
      const businessDataRaw = session.metadata?.businessData;
      const businessIdFromMeta = session.metadata?.businessId;
      if (planId === "sponsor" && businessDataRaw && typeof businessDataRaw === "string") {
        try {
          const businessData = JSON.parse(businessDataRaw) as Record<string, unknown>;
          await createBusinessFromMetadata(memberId, businessData);
        } catch (bErr) {
          console.error("[webhook] business create from checkout metadata:", bErr);
        }
      } else if ((planId === "sponsor" || planId === "seller") && businessIdFromMeta) {
        if (process.env.NODE_ENV === "development") console.log("[webhook] Business already created as draft:", businessIdFromMeta);
      }
    }

    const meta = session.metadata ?? {};
    const orderIdsRaw = meta.orderIds && typeof meta.orderIds === "string" ? meta.orderIds : null;
    const chunks: string[] = orderIdsRaw?.trim() ? [orderIdsRaw.trim()] : [];
    for (let i = 0; ; i++) {
      const key = `orderIds_${i}`;
      const val = meta[key];
      if (val && typeof val === "string" && val.trim()) chunks.push(val.trim());
      else break;
    }
    const orderIdsList: string[] = chunks.length > 0
      ? chunks.flatMap((s) => s.split(",").map((id) => id.trim()).filter(Boolean))
      : [];
    const singleOrderId = meta.orderId && typeof meta.orderId === "string" ? meta.orderId.trim() : null;
    const toProcess: string[] = orderIdsList.length > 0 ? orderIdsList : singleOrderId ? [singleOrderId] : [];

    if (session.mode === "payment" && toProcess.length === 0) {
      console.warn("[webhook] checkout.session.completed: no order IDs in metadata", {
        mode: session.mode,
        metadataKeys: Object.keys(meta),
        metadataOrderIds: meta.orderIds != null ? String(meta.orderIds).slice(0, 200) : undefined,
      });
    }

    if (session.mode === "payment" && toProcess.length > 0) {
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;

      for (const orderId of toProcess) {
        const order = await prisma.storeOrder.findFirst({
          where: { id: orderId, status: "pending" },
          include: { items: true },
        });
        if (!order) continue;

        const totalCents = order.totalCents;
        const platformFeeCents = Math.max(50, Math.floor(totalCents * 0.05));
        const sellerCreditsCents = totalCents - platformFeeCents;
        let pointsAwarded = Math.round(totalCents / 200);
        const subscriber = await prisma.subscription.findFirst({
          where: { memberId: order.buyerId, plan: "subscribe", status: "active" },
        });
        if (subscriber) pointsAwarded *= 2;

        await prisma.storeOrder.update({
          where: { id: order.id },
          data: {
            status: "paid",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            pointsAwarded,
          },
        });

        const storeItemsForOrder = await prisma.storeItem.findMany({
          where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
        });
        const storeItemMap = new Map(storeItemsForOrder.map((s) => [s.id, s]));
        for (const oi of order.items) {
          const storeItem = storeItemMap.get(oi.storeItemId);
          if (storeItem && hasOptionQuantities(storeItem.variants) && oi.variant) {
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

        await awardPoints(order.buyerId, pointsAwarded);

        const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
        awardLocalBusinessProBadge(order.buyerId).catch(() => {});

        await prisma.sellerBalance.upsert({
          where: { memberId: order.sellerId },
          create: {
            memberId: order.sellerId,
            balanceCents: sellerCreditsCents,
            totalEarnedCents: sellerCreditsCents,
          },
          update: {
            balanceCents: { increment: sellerCreditsCents },
            totalEarnedCents: { increment: sellerCreditsCents },
          },
        });
        await prisma.sellerBalanceTransaction.create({
          data: {
            memberId: order.sellerId,
            type: "sale",
            amountCents: sellerCreditsCents,
            orderId: order.id,
            description: `Sale: Order #${order.id.slice(-6)}`,
          },
        });

        const storeItemIds = order.items.map((oi) => oi.storeItemId);
        const storeItems = await prisma.storeItem.findMany({
          where: { id: { in: storeItemIds } },
          select: { listingType: true },
        });
        const allResale =
          storeItems.length === storeItemIds.length &&
          storeItems.every((s) => s.listingType === "resale");
        if (allResale) {
          const sellerPoints = Math.round(totalCents / 100);
          await awardPoints(order.sellerId, sellerPoints);
        }

        if (order.shippingCostCents > 0) {
          try {
            await stripe.payouts.create({
              amount: order.shippingCostCents,
              currency: "usd",
              method: "instant",
              metadata: { orderId: order.id, reason: "shipping" },
            });
          } catch (payoutErr) {
            console.error("[webhook] Instant payout for shipping failed:", payoutErr);
          }
        }
      }
    }

    const buyerId = session.metadata?.buyerId;
    const sellerId = session.metadata?.sellerId;
    if (buyerId && sellerId && session.mode === "payment") {
      const existing = await prisma.storeOrder.findFirst({
        where: { stripeCheckoutSessionId: session.id },
      });
      if (!existing) {
        const subtotalCents = parseInt(session.metadata?.subtotalCents ?? "0", 10);
        const shippingCostCents = parseInt(session.metadata?.shippingCostCents ?? "0", 10);
        const totalCents =
          parseInt(session.metadata?.totalCents ?? "0", 10) || subtotalCents + shippingCostCents;
        const platformFeeCents = parseInt(session.metadata?.platformFeeCents ?? "0", 10);
        let pointsAwarded = Math.round(totalCents / 200);
        const subscriber = await prisma.subscription.findFirst({
          where: { memberId: buyerId, plan: "subscribe", status: "active" },
        });
        if (subscriber) pointsAwarded *= 2;
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
        let shippingAddress: unknown = null;
        try {
          const sa = session.metadata?.shippingAddress;
          if (sa) shippingAddress = JSON.parse(sa) as unknown;
        } catch {
          /* ignore */
        }
        let localDeliveryDetails: unknown = null;
        try {
          const ld = session.metadata?.localDeliveryDetails;
          if (ld) localDeliveryDetails = JSON.parse(ld) as unknown;
        } catch {
          /* ignore */
        }
        const itemsJson = session.metadata?.items ?? "[]";
        let orderItems: {
          storeItemId: string;
          quantity: number;
          priceCentsAtPurchase: number;
          variant?: unknown;
          fulfillmentType?: string;
        }[];
        try {
          orderItems = JSON.parse(itemsJson) as typeof orderItems;
        } catch {
          orderItems = [];
        }

        const order = await prisma.storeOrder.create({
          data: {
            buyerId,
            sellerId,
            subtotalCents,
            shippingCostCents,
            totalCents,
            status: "paid",
            shippingAddress: shippingAddress === null ? Prisma.JsonNull : (shippingAddress as object),
            localDeliveryDetails: localDeliveryDetails === null ? Prisma.JsonNull : (localDeliveryDetails as object),
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            pointsAwarded,
          },
        });

        const storeItemsForNewOrder = await prisma.storeItem.findMany({
          where: { id: { in: orderItems.map((oi) => oi.storeItemId) } },
        });
        const storeItemMapNew = new Map(storeItemsForNewOrder.map((s) => [s.id, s]));
        for (const oi of orderItems) {
          await prisma.orderItem.create({
            data: {
              orderId: order.id,
              storeItemId: oi.storeItemId,
              quantity: oi.quantity,
              priceCentsAtPurchase: oi.priceCentsAtPurchase,
              variant: oi.variant === null || oi.variant === undefined ? Prisma.JsonNull : (oi.variant as object),
              fulfillmentType: oi.fulfillmentType ?? null,
            },
          });
          const storeItem = storeItemMapNew.get(oi.storeItemId);
          if (storeItem && hasOptionQuantities(storeItem.variants) && oi.variant) {
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

        await awardPoints(buyerId, pointsAwarded);

        const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
        awardLocalBusinessProBadge(buyerId).catch(() => {});

        const sellerCreditsCents = totalCents - platformFeeCents;
        await prisma.sellerBalance.upsert({
          where: { memberId: sellerId },
          create: {
            memberId: sellerId,
            balanceCents: sellerCreditsCents,
            totalEarnedCents: sellerCreditsCents,
          },
          update: {
            balanceCents: { increment: sellerCreditsCents },
            totalEarnedCents: { increment: sellerCreditsCents },
          },
        });
        await prisma.sellerBalanceTransaction.create({
          data: {
            memberId: sellerId,
            type: "sale",
            amountCents: sellerCreditsCents,
            orderId: order.id,
            description: `Sale: Order #${order.id.slice(-6)}`,
          },
        });

        const { sendPushNotification } = await import("@/lib/send-push-notification");
        sendPushNotification(sellerId, {
          title: "You sold an item",
          body: "A customer purchased from your store.",
          data: { screen: "seller-hub/orders", orderId: order.id },
        }).catch(() => {});

        const storeItemIds = orderItems.map((oi) => oi.storeItemId);
        const storeItems = await prisma.storeItem.findMany({
          where: { id: { in: storeItemIds } },
          select: { listingType: true },
        });
        const allResale =
          storeItems.length === storeItemIds.length &&
          storeItems.every((s) => s.listingType === "resale");
        if (allResale) {
          const sellerPoints = Math.round(totalCents / 100);
          await awardPoints(sellerId, sellerPoints);
        }

        if (shippingCostCents > 0) {
          try {
            await stripe.payouts.create({
              amount: shippingCostCents,
              currency: "usd",
              method: "instant",
              metadata: { orderId: order.id, reason: "shipping" },
            });
          } catch (payoutErr) {
            console.error("[webhook] Instant payout for shipping failed:", payoutErr);
          }
        }
      }
    }
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const connectAccountId = (event as Stripe.Event & { account?: string }).account ?? null;
    const isConnectEvent = Boolean(connectAccountId);
    const piMeta = paymentIntent.metadata ?? {};

    const orderIdsList: string[] = (() => {
      const orderId = piMeta.orderId && typeof piMeta.orderId === "string" ? piMeta.orderId.trim() : null;
      if (orderId) return [orderId];
      const orderIdsRaw = piMeta.orderIds && typeof piMeta.orderIds === "string" ? piMeta.orderIds.trim() : null;
      if (orderIdsRaw) {
        return orderIdsRaw.split(",").map((id) => id.trim()).filter(Boolean);
      }
      return [];
    })();

    if (orderIdsList.length === 0 && Object.keys(piMeta).length > 0) {
      console.warn("[webhook] payment_intent.succeeded: no order ID(s) in metadata", {
        metadataKeys: Object.keys(piMeta),
      });
    }

    for (const orderId of orderIdsList) {
      const order = await prisma.storeOrder.findFirst({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) continue;

      // Idempotency: do not process the same payment twice (Stripe may redeliver payment_intent.succeeded)
      if (order.status === "paid" && order.stripePaymentIntentId === paymentIntent.id) continue;

      // Only process pending orders (avoid race / duplicate events)
      if (order.status !== "pending") continue;

      // Connect events: ensure payment was for this order's seller's Connect account (funds go to seller, not platform)
      let sellerConnectAccountId: string | null = null;
      if (isConnectEvent && connectAccountId) {
        const seller = await prisma.member.findUnique({
          where: { id: order.sellerId },
          select: { stripeConnectAccountId: true },
        });
        if (seller?.stripeConnectAccountId !== connectAccountId) {
          console.warn("[webhook] payment_intent.succeeded: Connect account mismatch, skipping order", {
            orderId,
            eventAccount: connectAccountId,
            orderSellerId: order.sellerId,
          });
          continue;
        }
        sellerConnectAccountId = seller?.stripeConnectAccountId ?? null;
      }

      // Validate inventory before fulfilling (rare race: another buyer may have taken the last unit)
      const storeItemsForValidation = await prisma.storeItem.findMany({
        where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
      });
      const storeItemMapValidation = new Map(storeItemsForValidation.map((s) => [s.id, s]));
      const insufficientItems: { title: string }[] = [];
      for (const oi of order.items) {
        const storeItem = storeItemMapValidation.get(oi.storeItemId);
        const available = storeItem ? getAvailableQuantity(storeItem, oi.variant) : 0;
        if (available < oi.quantity) {
          insufficientItems.push({ title: storeItem?.title ?? "Item" });
        }
      }
      if (insufficientItems.length > 0) {
        const itemTitles = insufficientItems.map((i) => i.title).join(", ");
        try {
          const refundOpts = sellerConnectAccountId
            ? { stripeAccount: sellerConnectAccountId }
            : {};
          await stripe.refunds.create(
            {
              payment_intent: paymentIntent.id,
              reason: "requested_by_customer",
            },
            refundOpts as { stripeAccount?: string }
          );
        } catch (refundErr) {
          console.error("[webhook] payment_intent.succeeded: refund failed (sold before checkout)", refundErr);
        }
        await prisma.storeOrder.update({
          where: { id: order.id },
          data: {
            status: "canceled",
            cancelReason: "Item sold before checkout was complete",
            cancelNote: itemTitles,
          },
        });
        const { sendPushNotification } = await import("@/lib/send-push-notification");
        sendPushNotification(order.buyerId, {
          title: "Order canceled",
          body:
            insufficientItems.length === 1
              ? `This item sold before checkout was complete: ${insufficientItems[0].title}`
              : `These items sold before checkout was complete: ${itemTitles}`,
          data: { screen: "my-orders", orderId: order.id },
        }).catch(() => {});
        continue;
      }

      const totalCents = order.totalCents;
      let pointsAwarded = Math.round(totalCents / 200);
      const subscriber = await prisma.subscription.findFirst({
        where: { memberId: order.buyerId, plan: "subscribe", status: "active" },
      });
      if (subscriber) pointsAwarded *= 2;

      await prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          stripePaymentIntentId: paymentIntent.id,
          pointsAwarded,
        },
      });

      const storeItemsPaymentIntent = await prisma.storeItem.findMany({
        where: { id: { in: order.items.map((oi) => oi.storeItemId) } },
      });
      const storeItemMapPI = new Map(storeItemsPaymentIntent.map((s) => [s.id, s]));
      const soldOutStoreItemIds = new Set<string>();
      for (const oi of order.items) {
        const storeItem = storeItemMapPI.get(oi.storeItemId);
        if (storeItem && hasOptionQuantities(storeItem.variants) && oi.variant) {
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
          soldOutStoreItemIds.add(oi.storeItemId);
          await prisma.storeItem.update({
            where: { id: oi.storeItemId },
            data: { status: "sold_out" },
          });
          const { deleteFeedPostsForSoldItem } = await import("@/lib/delete-posts-for-sold-item");
          deleteFeedPostsForSoldItem(oi.storeItemId).catch(() => {});
        }
      }

      // Notify other buyers who had this item in a pending order (they never paid—no refund)
      if (soldOutStoreItemIds.size > 0) {
        const otherPendingOrderItems = await prisma.orderItem.findMany({
          where: {
            storeItemId: { in: [...soldOutStoreItemIds] },
            order: { status: "pending", buyerId: { not: order.buyerId } },
          },
          include: { order: { select: { id: true, buyerId: true } } },
        });
        const ordersToCancel = new Set<string>();
        const notifiedBuyerItems = new Set<string>();
        for (const oi of otherPendingOrderItems) {
          if (!oi.order) continue;
          ordersToCancel.add(oi.order.id);
          const key = `${oi.order.buyerId}:${oi.storeItemId}`;
          if (notifiedBuyerItems.has(key)) continue;
          notifiedBuyerItems.add(key);
          const title = storeItemMapPI.get(oi.storeItemId)?.title ?? "Item";
          const { sendPushNotification } = await import("@/lib/send-push-notification");
          sendPushNotification(oi.order.buyerId, {
            title: "Item no longer available",
            body: `This item sold before checkout was complete: ${title}`,
            data: { screen: "cart" },
          }).catch(() => {});
        }
        if (ordersToCancel.size > 0) {
          await prisma.storeOrder.updateMany({
            where: { id: { in: [...ordersToCancel] } },
            data: {
              status: "canceled",
              cancelReason: "Item sold before checkout was complete",
            },
          });
        }
      }

      // Remove purchased items from the buyer's cart
      await prisma.cartItem.deleteMany({
        where: { memberId: order.buyerId },
      });

      await awardPoints(order.buyerId, pointsAwarded);

      if (!isConnectEvent) {
        const platformFeeCents = Math.max(50, Math.floor(totalCents * 0.05));
        const sellerCreditsCents = totalCents - platformFeeCents;
        await prisma.sellerBalance.upsert({
          where: { memberId: order.sellerId },
          create: {
            memberId: order.sellerId,
            balanceCents: sellerCreditsCents,
            totalEarnedCents: sellerCreditsCents,
          },
          update: {
            balanceCents: { increment: sellerCreditsCents },
            totalEarnedCents: { increment: sellerCreditsCents },
          },
        });
        await prisma.sellerBalanceTransaction.create({
          data: {
            memberId: order.sellerId,
            type: "sale",
            amountCents: sellerCreditsCents,
            orderId: order.id,
            description: `Sale: Order #${order.id.slice(-6)}`,
          },
        });
        if (order.shippingCostCents > 0) {
          try {
            await stripe.payouts.create({
              amount: order.shippingCostCents,
              currency: "usd",
              method: "instant",
              metadata: { orderId: order.id, reason: "shipping" },
            });
          } catch (payoutErr) {
            console.error("[webhook] Instant payout for shipping failed:", payoutErr);
          }
        }
      }

      const { sendPushNotification } = await import("@/lib/send-push-notification");
      sendPushNotification(order.sellerId, {
        title: "You sold an item",
        body: "A customer purchased from your store.",
        data: { screen: "seller-hub/orders", orderId: order.id },
      }).catch(() => {});

      const storeItemIds = order.items.map((oi) => oi.storeItemId);
      const storeItems = await prisma.storeItem.findMany({
        where: { id: { in: storeItemIds } },
        select: { listingType: true },
      });
      const allResale =
        storeItems.length === storeItemIds.length &&
        storeItems.every((s) => s.listingType === "resale");
      if (allResale) {
        const sellerPoints = Math.round(totalCents / 100);
        await awardPoints(order.sellerId, sellerPoints);
      }
    }
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoice.subscription;
    if (subId) {
      const subIdStr = typeof subId === "string" ? subId : subId.id;
      const existing = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subIdStr },
      });
      if (!existing) {
        try {
          const sub = await stripe.subscriptions.retrieve(subIdStr);
          const memberId = sub.metadata?.memberId;
          const planId = sub.metadata?.planId as "subscribe" | "sponsor" | "seller" | undefined;
          if (memberId && planId) {
            await prisma.subscription.create({
              data: {
                memberId,
                plan: planId,
                stripeSubscriptionId: subIdStr,
                stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
                status: "active",
              },
            });
            const businessDataRaw = sub.metadata?.businessData;
            const businessIdFromSub = sub.metadata?.businessId;
            if (
              (planId === "sponsor" || planId === "seller") &&
              businessDataRaw &&
              typeof businessDataRaw === "string"
            ) {
              try {
                const businessData = JSON.parse(businessDataRaw) as Record<string, unknown>;
                await createBusinessFromMetadata(memberId, businessData);
              } catch (bErr) {
                console.error("[webhook] business create from invoice metadata:", bErr);
              }
            } else if ((planId === "sponsor" || planId === "seller") && businessIdFromSub) {
              if (process.env.NODE_ENV === "development") console.log("[webhook] Business already created as draft:", businessIdFromSub);
            }
          }
        } catch (err) {
          console.error("[webhook] invoice.payment_succeeded subscription handle:", err);
        }
      }
    }
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: sub.id },
      data: {
        status: sub.status === "active" ? "active" : sub.status === "trialing" ? "active" : "canceled",
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      },
    });
  }
  return NextResponse.json({ received: true });
}
