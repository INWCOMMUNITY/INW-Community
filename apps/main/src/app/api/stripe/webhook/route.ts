import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma, Prisma } from "database";
import { awardPoints } from "@/lib/award-points";
import { orderQualifiesForDeferredBuyerPoints } from "@/lib/store-order-buyer-points";
import { getAvailableQuantity } from "@/lib/store-item-variants";
import { applyStoreItemDecrementAfterSale } from "@/lib/store-item-inventory-sale";
import { shouldMarkStoreItemSoldOut } from "@/lib/store-item-variants";
import {
  cancelPendingOrdersForSoldOutItems,
  cleanupOtherBuyersCartsForStoreItems,
  validateBatchStoreOrdersInventory,
} from "@/lib/post-sale-inventory-cleanup";
import { disconnectStripeAndDisableListings } from "@/lib/stripe-connect-disconnect";
import { normalizeSubcategoriesByPrimary } from "@/lib/business-categories";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import { stripeSubscriptionStatusToDb } from "@/lib/stripe-subscription-db-status";
import { planFromStripePriceId } from "@/lib/stripe-price-to-plan";
import { removeNwcMemberPerksAfterSubscriptionEnd } from "@/lib/nwc-subscription-perk-cleanup";
import { migrateResaleItemsForSellerMember } from "@/lib/migrate-resale-items-for-seller-plan";
import { orderIdsFromCheckoutSessionMetadata } from "@/lib/stripe-checkout-order-ids";
import {
  shippingAddressFromCheckoutSession,
  storeOrderNeedsShippingBackfill,
} from "@/lib/stripe-checkout-session-shipping";
import {
  allocateTaxCentsAcrossOrders,
  assertPreTaxSplitMatchesOrderTotal,
  computeSellerTransferCents,
} from "@/lib/storefront-payout";
import type { Plan } from "database";

/**
 * Idempotency: Stripe may deliver the same event more than once. All handlers in this file
 * must be safe when run multiple times for the same event (e.g. check order.status === "paid"
 * and stripePaymentIntentId before updating, skip if already processed). Do not assume
 * one-to-one event-to-order updates.
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

/** Node runtime: raw body + Buffer match what stripe-node expects; avoid Edge subtle differences. */
export const runtime = "nodejs";

export const dynamic = "force-dynamic";

function parseWebhookSecretList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function constructEventWithAnySecret(
  body: Buffer,
  sig: string,
  secrets: string[],
  toleranceSeconds: number
): { event: Stripe.Event | null; lastError: unknown } {
  let lastError: unknown = new Error("No webhook signing secrets provided");
  for (const secret of secrets) {
    try {
      return {
        event: stripe.webhooks.constructEvent(body, sig, secret, toleranceSeconds),
        lastError: null,
      };
    } catch (e) {
      lastError = e;
    }
  }
  return { event: null, lastError };
}

function subscriptionIdFromCheckoutSession(session: Stripe.Checkout.Session): string | null {
  const sub = session.subscription;
  if (typeof sub === "string" && sub.length > 0) return sub;
  if (sub && typeof sub === "object" && !Array.isArray(sub) && "id" in sub) {
    const id = (sub as Stripe.Subscription).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function createBusinessFromMetadata(
  memberId: string,
  data: Record<string, unknown>,
  ctx?: { planId?: "subscribe" | "sponsor" | "seller" }
): Promise<void> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const shortDescription = typeof data.shortDescription === "string" ? data.shortDescription.trim() : null;
  const fullDescription = typeof data.fullDescription === "string" ? data.fullDescription.trim() : null;
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];

  if (!name || !city || categories.length === 0) return;

  // Business → Seller: keep existing Business Hub row; do not duplicate from subscription metadata.
  if (ctx?.planId === "seller") {
    const existingAny = await prisma.business.findFirst({
      where: { memberId },
      select: { id: true },
    });
    if (existingAny) return;
  }

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
      subcategoriesByPrimary: normalizeSubcategoriesByPrimary(categories, data.subcategoriesByPrimary),
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
  const platformSecrets = parseWebhookSecretList(process.env.STRIPE_WEBHOOK_SECRET);
  const connectSecrets = parseWebhookSecretList(process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
  /** Thin / event-destination webhooks (e.g. v2.core.*) use a different signing secret than snapshot endpoints. */
  const thinSecrets = parseWebhookSecretList(process.env.STRIPE_THIN_WEBHOOK_SECRET);
  if (
    platformSecrets.length === 0 &&
    connectSecrets.length === 0 &&
    thinSecrets.length === 0
  ) {
    console.warn(
      "[stripe/webhook] 400: no webhook signing secrets configured (STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_THIN_WEBHOOK_SECRET)"
    );
    return NextResponse.json({ error: "Missing webhook secret(s)" }, { status: 400 });
  }

  // Tolerance (seconds) for timestamp in signature to allow for clock skew
  const toleranceSeconds = 300;
  let event: Stripe.Event | null = null;
  let lastError: unknown = new Error("No matching webhook signing secret");
  if (platformSecrets.length > 0) {
    const r = constructEventWithAnySecret(body, sig, platformSecrets, toleranceSeconds);
    event = r.event;
    lastError = r.lastError;
  }
  if (!event && connectSecrets.length > 0) {
    const r = constructEventWithAnySecret(body, sig, connectSecrets, toleranceSeconds);
    event = r.event;
    lastError = r.lastError ?? lastError;
  }
  if (!event && thinSecrets.length > 0) {
    const r = constructEventWithAnySecret(body, sig, thinSecrets, toleranceSeconds);
    event = r.event;
    lastError = r.lastError ?? lastError;
  }
  if (!event) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    console.warn("[stripe/webhook] 400: invalid signature", {
      detail: msg,
      hint: "Ensure STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET (Connect), and/or STRIPE_THIN_WEBHOOK_SECRET (thin / v2.core event destinations) match each destination's signing secret in Stripe. The request body must be raw (unmodified) for verification.",
    });
    return NextResponse.json(
      {
        error: "Invalid signature",
        hint:
          "Each Stripe webhook or event destination has its own signing secret (whsec_...). Snapshot events (checkout.session.completed, etc.) use STRIPE_WEBHOOK_SECRET from Developers → Webhooks. Thin destinations (v2.core.*) need that destination's secret in STRIPE_THIN_WEBHOOK_SECRET. Use Live secrets for livemode events.",
      },
      { status: 400 }
    );
  }

  /** Snapshot / v1 events that actually write or update Subscription rows (thin v2.core.* events do not). */
  const SUBSCRIPTION_RELATED_EVENT_TYPES = new Set([
    "checkout.session.completed",
    "invoice.payment_succeeded",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (SUBSCRIPTION_RELATED_EVENT_TYPES.has(event.type)) {
    console.info("[stripe/webhook] subscription-related event received", {
      type: event.type,
      eventId: event.id,
    });
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
    const memberId =
      (session.metadata?.memberId && session.metadata.memberId.trim()) ||
      (session.client_reference_id && session.client_reference_id.trim()) ||
      undefined;
    let planId = session.metadata?.planId as "subscribe" | "sponsor" | "seller" | undefined;
    let subId = subscriptionIdFromCheckoutSession(session);
    if (!subId && session.mode === "subscription") {
      try {
        const full = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["subscription"],
        });
        subId = subscriptionIdFromCheckoutSession(full);
      } catch (reErr) {
        console.error("[stripe/webhook] checkout.session.completed: retrieve session failed", reErr);
      }
    }

    if (memberId && subId && (!planId || !["subscribe", "sponsor", "seller"].includes(planId))) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        const mp = stripeSub.metadata?.planId?.trim();
        if (mp === "subscribe" || mp === "sponsor" || mp === "seller") {
          planId = mp;
        }
        if (!planId) {
          const raw = stripeSub.items.data[0]?.price;
          const priceId = typeof raw === "string" ? raw : raw?.id ?? null;
          const p = planFromStripePriceId(priceId);
          if (p) planId = p;
        }
      } catch (subErr) {
        console.error("[stripe/webhook] checkout.session.completed: retrieve subscription for planId failed", subErr);
      }
    }

    if ((!memberId || !planId || !subId) && session.mode === "subscription") {
      console.warn("[stripe/webhook] checkout.session.completed: subscription upsert skipped (missing fields)", {
        sessionId: session.id,
        mode: session.mode,
        upsertSkipped: true,
        hasMemberId: Boolean(memberId),
        hasPlanId: Boolean(planId),
        hasSubId: Boolean(subId),
        hasClientReferenceId: Boolean(session.client_reference_id?.trim()),
      });
    }

    if (memberId && planId && subId) {
      const checkoutCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer &&
              typeof session.customer === "object" &&
              !Array.isArray(session.customer) &&
              "id" in session.customer
            ? (session.customer as Stripe.Customer).id
            : null;

      const existingSub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      if (existingSub) {
        // Idempotent checkout + reactivation: row may already exist (retry, or prior canceled state).
        await prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            memberId,
            plan: planId,
            status: "active",
            ...(checkoutCustomerId ? { stripeCustomerId: checkoutCustomerId } : {}),
          },
        });
      } else {
        await prisma.subscription.create({
          data: {
            memberId,
            plan: planId,
            stripeSubscriptionId: subId,
            stripeCustomerId: checkoutCustomerId,
            status: "active",
          },
        });
      }
      console.info("[stripe/webhook] checkout.session.completed: subscription upsert ok", {
        sessionId: session.id,
        stripeSubscriptionId: subId,
        planId,
        memberId,
      });
      if (checkoutCustomerId) {
        const m = await prisma.member.findUnique({
          where: { id: memberId },
          select: { stripeCustomerId: true },
        });
        if (!m?.stripeCustomerId?.trim()) {
          await prisma.member.update({
            where: { id: memberId },
            data: { stripeCustomerId: checkoutCustomerId },
          });
        } else if (m.stripeCustomerId !== checkoutCustomerId) {
          console.warn("[stripe/webhook] checkout.session.completed: Stripe customer id mismatch for member", {
            memberId,
            memberCustomer: m.stripeCustomerId,
            sessionCustomer: checkoutCustomerId,
          });
        }
      }
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
      if (planId === "seller") {
        migrateResaleItemsForSellerMember(memberId).catch((err) =>
          console.error("[stripe/webhook] migrate resale items for seller", memberId, err)
        );
      }
    }

    const meta = session.metadata ?? {};
    const toProcess: string[] = orderIdsFromCheckoutSessionMetadata(
      meta as Record<string, string | null | undefined>
    );

    if (session.mode === "payment" && toProcess.length === 0) {
      console.warn("[webhook] checkout.session.completed: no order IDs in metadata", {
        mode: session.mode,
        metadataKeys: Object.keys(meta),
        metadataOrderIds: meta.orderIds != null ? String(meta.orderIds).slice(0, 200) : undefined,
      });
    }

    if (session.mode === "payment" && toProcess.length > 0) {
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;

      const ordersToFulfill = [];
      for (const orderId of toProcess) {
        const order = await prisma.storeOrder.findFirst({
          where: { id: orderId, status: "pending" },
          include: { items: true },
        });
        if (order) ordersToFulfill.push(order);
      }

      if (ordersToFulfill.length > 0) {
        const uniqueStoreIds = [...new Set(ordersToFulfill.flatMap((o) => o.items.map((i) => i.storeItemId)))];
        const storeItemsForValidation = await prisma.storeItem.findMany({
          where: { id: { in: uniqueStoreIds } },
        });
        const storeItemMapValidation = new Map(storeItemsForValidation.map((s) => [s.id, s]));

        const batchCheck = validateBatchStoreOrdersInventory(ordersToFulfill, storeItemMapValidation);
        if (!batchCheck.ok) {
          const itemTitles = [...new Set(batchCheck.titles)].join(", ");
          try {
            if (paymentIntentId) {
              await stripe.refunds.create({
                payment_intent: paymentIntentId,
                reason: "requested_by_customer",
              });
            }
          } catch (refundErr) {
            console.error("[webhook] checkout.session.completed: refund failed (inventory)", refundErr);
          }
          const buyerId = ordersToFulfill[0].buyerId;
          await prisma.storeOrder.updateMany({
            where: { id: { in: ordersToFulfill.map((o) => o.id) } },
            data: {
              status: "canceled",
              cancelReason: "Item sold before checkout was complete",
              cancelNote: itemTitles,
            },
          });
          const { sendPushNotification } = await import("@/lib/send-push-notification");
          sendPushNotification(buyerId, {
            title: "We couldn’t finish that checkout",
            body:
              batchCheck.titles.length === 1
                ? `Someone else bought “${batchCheck.titles[0]}” before payment went through — nothing was charged.`
                : `Someone else bought these before payment went through: ${itemTitles}. You weren’t charged.`,
            data: { screen: "my-orders" },
            category: "commerce",
          }).catch(() => {});
        } else {
          const allSoldOutIds = new Set<string>();
          const allPurchasedIds = new Set<string>();
          const titleByItemId = new Map<string, string>();
          const sessionAmountSubtotal = session.amount_subtotal ?? 0;
          const sessionTaxCents = session.total_details?.amount_tax ?? 0;

          const taxByOrderId = allocateTaxCentsAcrossOrders(
            ordersToFulfill.map((o) => ({ id: o.id, totalCents: o.totalCents })),
            sessionAmountSubtotal,
            sessionTaxCents
          );

          type PayoutRow = {
            platformFeeCents: number;
            salesTaxReserveCents: number;
            sellerTransferCents: number;
            orderTaxCents: number;
            sellerCreditsCents: number;
          };
          const payoutByOrderId = new Map<string, PayoutRow>();
          for (const order of ordersToFulfill) {
            const { platformFeeCents, salesTaxReserveCents, sellerTransferCents } = computeSellerTransferCents(
              order.totalCents,
              order.subtotalCents
            );
            const orderTaxCents = taxByOrderId.get(order.id) ?? 0;
            payoutByOrderId.set(order.id, {
              platformFeeCents,
              salesTaxReserveCents,
              sellerTransferCents,
              orderTaxCents,
              sellerCreditsCents: sellerTransferCents,
            });
          }

          const sumOrderTotals = ordersToFulfill.reduce((acc, o) => acc + o.totalCents, 0);
          if (sumOrderTotals !== sessionAmountSubtotal) {
            console.warn("[webhook] checkout.session.completed: amount_subtotal vs sum(order.totalCents)", {
              sessionAmountSubtotal,
              sumOrderTotals,
              sessionId: session.id,
            });
          }
          for (const order of ordersToFulfill) {
            const p = payoutByOrderId.get(order.id)!;
            assertPreTaxSplitMatchesOrderTotal(order, {
              platformFeeCents: p.platformFeeCents,
              salesTaxReserveCents: p.salesTaxReserveCents,
              sellerTransferCents: p.sellerTransferCents,
            });
          }

          let chargeId: string | null = null;
          if (paymentIntentId) {
            try {
              const piRetrieved = await stripe.paymentIntents.retrieve(paymentIntentId, {
                expand: ["latest_charge"],
              });
              const ch = piRetrieved.latest_charge;
              chargeId =
                typeof ch === "string"
                  ? ch
                  : ch && typeof ch === "object" && "id" in ch
                    ? (ch as Stripe.Charge).id
                    : null;
            } catch (piErr) {
              console.error("[webhook] retrieve PI for Connect transfer:", piErr);
            }
          }

          const sellerIdList = [...new Set(ordersToFulfill.map((o) => o.sellerId))];
          const sellerRows = await prisma.member.findMany({
            where: { id: { in: sellerIdList } },
            select: { id: true, stripeConnectAccountId: true },
          });
          const connectBySellerId = new Map(sellerRows.map((r) => [r.id, r.stripeConnectAccountId?.trim() ?? ""]));

          let abortOrderFulfillment = false;
          const transfersToReverse: string[] = [];
          const transferIdByOrderId = new Map<string, string>();

          try {
            for (const order of ordersToFulfill) {
              const payout = payoutByOrderId.get(order.id);
              if (!payout || payout.sellerTransferCents <= 0) continue;
              const connectId = connectBySellerId.get(order.sellerId);
              if (!connectId) {
                throw new Error(`Seller has no Stripe Connect account (order ${order.id})`);
              }
              if (!chargeId) {
                throw new Error("Missing charge on payment intent; cannot pay sellers");
              }
              const tr = await stripe.transfers.create(
                {
                  amount: payout.sellerTransferCents,
                  currency: "usd",
                  destination: connectId,
                  source_transaction: chargeId,
                  metadata: { orderId: order.id },
                },
                { idempotencyKey: `nwc_store_transfer_${order.id}` }
              );
              transfersToReverse.push(tr.id);
              transferIdByOrderId.set(order.id, tr.id);
            }
          } catch (transferErr) {
            abortOrderFulfillment = true;
            console.error("[webhook] Connect transfer failed:", transferErr);
            for (const trId of transfersToReverse) {
              await stripe.transfers
                .createReversal(trId)
                .catch((revErr) => console.error("[webhook] transfer reversal failed:", revErr));
            }
            try {
              if (paymentIntentId) {
                await stripe.refunds.create({ payment_intent: paymentIntentId });
              }
            } catch (refundErr) {
              console.error("[webhook] refund after transfer failure:", refundErr);
            }
            await prisma.storeOrder.updateMany({
              where: { id: { in: ordersToFulfill.map((o) => o.id) } },
              data: {
                status: "canceled",
                cancelReason: "Payment to seller could not be completed",
                cancelNote:
                  transferErr instanceof Error ? transferErr.message.slice(0, 500) : "Transfer failed",
              },
            });
            const buyerIdFail = ordersToFulfill[0].buyerId;
            const { sendPushNotification: sendPushFail } = await import("@/lib/send-push-notification");
            sendPushFail(buyerIdFail, {
              title: "Order could not be completed",
              body: "Your payment was refunded. Please try again or contact support.",
              data: { screen: "my-orders" },
              category: "commerce",
            }).catch(() => {});
          }

          if (!abortOrderFulfillment) {
            const shipFromStripe = shippingAddressFromCheckoutSession(session);
            for (const order of ordersToFulfill) {
              const payout = payoutByOrderId.get(order.id)!;
              const totalCents = order.totalCents;
              let pointsAwarded = Math.round(totalCents / 200);
              const paidBuyer = await prisma.subscription.findFirst({
                where: prismaWhereActivePaidNwcPlan(order.buyerId),
              });
              if (paidBuyer) pointsAwarded *= 2;

              const backfillShipping =
                shipFromStripe && storeOrderNeedsShippingBackfill(order)
                  ? { shippingAddress: shipFromStripe as object }
                  : {};

              await prisma.storeOrder.update({
                where: { id: order.id },
                data: {
                  status: "paid",
                  stripeCheckoutSessionId: session.id,
                  stripePaymentIntentId: paymentIntentId,
                  pointsAwarded,
                  taxCents: payout.orderTaxCents,
                  salesTaxReserveCents: payout.salesTaxReserveCents,
                  platformFeeCents: payout.platformFeeCents,
                  ...backfillShipping,
                  ...(transferIdByOrderId.has(order.id)
                    ? { stripeSellerTransferId: transferIdByOrderId.get(order.id) }
                    : {}),
                },
              });

              const isRewardRedemption = order.orderKind === "reward_redemption";
              if (!isRewardRedemption) {
                for (const oi of order.items) {
                  allPurchasedIds.add(oi.storeItemId);
                  const storeItem = await prisma.storeItem.findUnique({
                    where: { id: oi.storeItemId },
                  });
                  if (storeItem) titleByItemId.set(oi.storeItemId, storeItem.title);
                  if (storeItem) {
                    await applyStoreItemDecrementAfterSale(prisma, storeItem, {
                      quantity: oi.quantity,
                      variant: oi.variant,
                    });
                  }
                  const updated = await prisma.storeItem.findUnique({
                    where: { id: oi.storeItemId },
                    select: { quantity: true, variants: true },
                  });
                  if (updated && shouldMarkStoreItemSoldOut(updated)) {
                    allSoldOutIds.add(oi.storeItemId);
                    await prisma.storeItem.update({
                      where: { id: oi.storeItemId },
                      data: { status: "sold_out" },
                    });
                    const { deleteFeedPostsForSoldItem } = await import("@/lib/delete-posts-for-sold-item");
                    deleteFeedPostsForSoldItem(oi.storeItemId).catch(() => {});
                  }
                }
              } else {
                await prisma.rewardRedemption.updateMany({
                  where: { storeOrderId: order.id },
                  data: { fulfillmentStatus: "paid" },
                });
              }

              if (!orderQualifiesForDeferredBuyerPoints(order.items)) {
                await awardPoints(order.buyerId, pointsAwarded);
              }

              const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
              awardLocalBusinessProBadge(order.buyerId).catch(() => {});

              await prisma.sellerBalance.upsert({
                where: { memberId: order.sellerId },
                create: {
                  memberId: order.sellerId,
                  balanceCents: payout.sellerCreditsCents,
                  totalEarnedCents: payout.sellerCreditsCents,
                },
                update: {
                  balanceCents: { increment: payout.sellerCreditsCents },
                  totalEarnedCents: { increment: payout.sellerCreditsCents },
                },
              });
              await prisma.sellerBalanceTransaction.create({
                data: {
                  memberId: order.sellerId,
                  type: "sale",
                  amountCents: payout.sellerCreditsCents,
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
            }
          }

          if (!abortOrderFulfillment) {
            const buyerId = ordersToFulfill[0].buyerId;
            if (allSoldOutIds.size > 0) {
              await cancelPendingOrdersForSoldOutItems({
                soldOutStoreItemIds: [...allSoldOutIds],
                excludeBuyerId: buyerId,
                titleByItemId,
              });
            }
            await cleanupOtherBuyersCartsForStoreItems({
              winningBuyerId: buyerId,
              purchasedStoreItemIds: [...allPurchasedIds],
            });
            await prisma.cartItem.deleteMany({
              where: {
                memberId: buyerId,
                storeItemId: { in: [...allPurchasedIds] },
              },
            });

            const roMeta =
              meta.resaleOfferIds && typeof meta.resaleOfferIds === "string" ? meta.resaleOfferIds.trim() : "";
            if (roMeta) {
              const roi = roMeta.split(",").map((x) => x.trim()).filter(Boolean);
              if (roi.length > 0) {
                await prisma.resaleOffer.updateMany({
                  where: { id: { in: roi }, status: "accepted" },
                  data: { status: "completed" },
                });
              }
            }
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
        const legacySessionTaxCents =
          typeof session.total_details?.amount_tax === "number" ? session.total_details.amount_tax : 0;
        const { platformFeeCents, salesTaxReserveCents, sellerTransferCents } = computeSellerTransferCents(
          totalCents,
          subtotalCents
        );
        let pointsAwarded = Math.round(totalCents / 200);
        const paidBuyer = await prisma.subscription.findFirst({
          where: prismaWhereActivePaidNwcPlan(buyerId),
        });
        if (paidBuyer) pointsAwarded *= 2;
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
            taxCents: legacySessionTaxCents,
            salesTaxReserveCents,
            platformFeeCents,
            status: "paid",
            shippingAddress: shippingAddress === null ? Prisma.JsonNull : (shippingAddress as object),
            localDeliveryDetails: localDeliveryDetails === null ? Prisma.JsonNull : (localDeliveryDetails as object),
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            pointsAwarded,
          },
        });
        assertPreTaxSplitMatchesOrderTotal(
          { id: order.id, totalCents },
          { platformFeeCents, salesTaxReserveCents, sellerTransferCents }
        );

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
          const storeItem = await prisma.storeItem.findUnique({
            where: { id: oi.storeItemId },
          });
          if (storeItem) {
            await applyStoreItemDecrementAfterSale(prisma, storeItem, {
              quantity: oi.quantity,
              variant: oi.variant,
            });
          }
          const updated = await prisma.storeItem.findUnique({
            where: { id: oi.storeItemId },
            select: { quantity: true, variants: true },
          });
          if (updated && shouldMarkStoreItemSoldOut(updated)) {
            await prisma.storeItem.update({
              where: { id: oi.storeItemId },
              data: { status: "sold_out" },
            });
            const { deleteFeedPostsForSoldItem } = await import("@/lib/delete-posts-for-sold-item");
            deleteFeedPostsForSoldItem(oi.storeItemId).catch(() => {});
          }
        }

        if (!orderQualifiesForDeferredBuyerPoints(orderItems)) {
          await awardPoints(buyerId, pointsAwarded);
        }

        const { awardLocalBusinessProBadge } = await import("@/lib/badge-award");
        awardLocalBusinessProBadge(buyerId).catch(() => {});

        const sellerCreditsCents = sellerTransferCents;
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
          title: "Woo Hoo! You made a sale!",
          body: "Someone just bought from your store — open the app to see the order!",
          data: { screen: "seller-hub/orders", orderId: order.id },
          category: "commerce",
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
          title: "We couldn’t finish that checkout",
          body:
            insufficientItems.length === 1
              ? `Someone else bought “${insufficientItems[0].title}” before payment went through — nothing was charged.`
              : `Someone else bought these before payment went through: ${itemTitles}. You weren’t charged.`,
          data: { screen: "my-orders", orderId: order.id },
          category: "commerce",
        }).catch(() => {});
        continue;
      }

      const totalCents = order.totalCents;
      let pointsAwarded = Math.round(totalCents / 200);
      const paidBuyer = await prisma.subscription.findFirst({
        where: prismaWhereActivePaidNwcPlan(order.buyerId),
      });
      if (paidBuyer) pointsAwarded *= 2;

      await prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          stripePaymentIntentId: paymentIntent.id,
          pointsAwarded,
        },
      });

      const soldOutStoreItemIds = new Set<string>();
      const titleByItemIdPI = new Map<string, string>();
      for (const oi of order.items) {
        const storeItem = await prisma.storeItem.findUnique({
          where: { id: oi.storeItemId },
        });
        if (storeItem) titleByItemIdPI.set(oi.storeItemId, storeItem.title);
        if (storeItem) {
          await applyStoreItemDecrementAfterSale(prisma, storeItem, {
            quantity: oi.quantity,
            variant: oi.variant,
          });
        }
        const updated = await prisma.storeItem.findUnique({
          where: { id: oi.storeItemId },
          select: { quantity: true, variants: true },
        });
        if (updated && shouldMarkStoreItemSoldOut(updated)) {
          soldOutStoreItemIds.add(oi.storeItemId);
          await prisma.storeItem.update({
            where: { id: oi.storeItemId },
            data: { status: "sold_out" },
          });
          const { deleteFeedPostsForSoldItem } = await import("@/lib/delete-posts-for-sold-item");
          deleteFeedPostsForSoldItem(oi.storeItemId).catch(() => {});
        }
      }

      if (soldOutStoreItemIds.size > 0) {
        await cancelPendingOrdersForSoldOutItems({
          soldOutStoreItemIds: [...soldOutStoreItemIds],
          excludeBuyerId: order.buyerId,
          titleByItemId: titleByItemIdPI,
        });
      }

      const purchasedIds = order.items.map((oi) => oi.storeItemId);
      await cleanupOtherBuyersCartsForStoreItems({
        winningBuyerId: order.buyerId,
        purchasedStoreItemIds: purchasedIds,
      });

      await prisma.cartItem.deleteMany({
        where: { memberId: order.buyerId, storeItemId: { in: purchasedIds } },
      });

      const roiMeta =
        typeof piMeta.resaleOfferIds === "string" ? piMeta.resaleOfferIds.trim() : "";
      if (roiMeta) {
        const roi = roiMeta.split(",").map((x) => x.trim()).filter(Boolean);
        if (roi.length > 0) {
          await prisma.resaleOffer.updateMany({
            where: { id: { in: roi }, status: "accepted" },
            data: { status: "completed" },
          });
        }
      }

      if (!orderQualifiesForDeferredBuyerPoints(order.items)) {
        await awardPoints(order.buyerId, pointsAwarded);
      }

      if (!isConnectEvent) {
        const { platformFeeCents, salesTaxReserveCents, sellerTransferCents } = computeSellerTransferCents(
          order.totalCents,
          order.subtotalCents
        );
        assertPreTaxSplitMatchesOrderTotal(order, {
          platformFeeCents,
          salesTaxReserveCents,
          sellerTransferCents,
        });
        const sellerCreditsCents = sellerTransferCents;
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
        title: "Woo Hoo! You made a sale!",
        body: "Someone just bought from your store — open the app to see the order!",
        data: { screen: "seller-hub/orders", orderId: order.id },
        category: "commerce",
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
          const memberId = sub.metadata?.memberId?.trim();
          let planId = sub.metadata?.planId?.trim() as "subscribe" | "sponsor" | "seller" | undefined;
          if (planId && !["subscribe", "sponsor", "seller"].includes(planId)) {
            planId = undefined;
          }
          if (!planId) {
            const raw = sub.items.data[0]?.price;
            const priceId = typeof raw === "string" ? raw : raw?.id ?? null;
            const p = planFromStripePriceId(priceId);
            if (p) planId = p;
          }
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
            console.info("[stripe/webhook] invoice.payment_succeeded: subscription row created", {
              stripeSubscriptionId: subIdStr,
              planId,
              memberId,
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
                await createBusinessFromMetadata(memberId, businessData, { planId });
              } catch (bErr) {
                console.error("[webhook] business create from invoice metadata:", bErr);
              }
            } else if ((planId === "sponsor" || planId === "seller") && businessIdFromSub) {
              if (process.env.NODE_ENV === "development") console.log("[webhook] Business already created as draft:", businessIdFromSub);
            }
          } else {
            console.warn("[stripe/webhook] invoice.payment_succeeded: subscription row not created (missing memberId or planId)", {
              subId: subIdStr,
              hasMemberId: Boolean(memberId),
              hasPlanId: Boolean(planId),
            });
          }
        } catch (err) {
          console.error("[webhook] invoice.payment_succeeded subscription handle:", err);
        }
      }
    }
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const mapped = stripeSubscriptionStatusToDb(sub.status);
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

    const affectedRows = await prisma.subscription.findMany({
      where: { stripeSubscriptionId: sub.id },
      select: { memberId: true },
    });

    const metaPlan = sub.metadata?.planId?.trim();
    const rawPrice = sub.items.data[0]?.price;
    const priceId = typeof rawPrice === "string" ? rawPrice : rawPrice?.id ?? null;
    const planFromPrice = planFromStripePriceId(priceId);
    const planResolved: Plan | undefined =
      metaPlan === "subscribe" || metaPlan === "sponsor" || metaPlan === "seller"
        ? (metaPlan as Plan)
        : planFromPrice ?? undefined;

    const data: Prisma.SubscriptionUpdateManyMutationInput = {
      currentPeriodEnd: periodEnd,
      ...(mapped !== null ? { status: mapped } : {}),
      ...(planResolved ? { plan: planResolved } : {}),
    };
    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: sub.id },
      data,
    });

    const sellerStripeActive =
      planResolved === "seller" &&
      (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due");
    if (sellerStripeActive) {
      const memberRows = await prisma.subscription.findMany({
        where: { stripeSubscriptionId: sub.id },
        select: { memberId: true },
      });
      const memberIds = [...new Set(memberRows.map((r) => r.memberId))];
      const metaMember = sub.metadata?.memberId?.trim();
      if (memberIds.length === 0 && metaMember) memberIds.push(metaMember);
      for (const mid of memberIds) {
        migrateResaleItemsForSellerMember(mid).catch((err) =>
          console.error("[stripe/webhook] migrate resale items for seller (subscription event)", mid, err)
        );
      }
    }

    const subscriptionEnded =
      event.type === "customer.subscription.deleted" ||
      sub.status === "canceled" ||
      sub.status === "unpaid" ||
      sub.status === "incomplete_expired";

    if (subscriptionEnded) {
      const uniqueMembers = [...new Set(affectedRows.map((r) => r.memberId))];
      for (const memberId of uniqueMembers) {
        await removeNwcMemberPerksAfterSubscriptionEnd(memberId).catch((err) =>
          console.error("[stripe/webhook] perk cleanup", memberId, err)
        );
      }
    }
  }
  return NextResponse.json({ received: true });
}
