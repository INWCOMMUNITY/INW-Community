import Stripe from "stripe";
import { prisma } from "database";
import { awardPoints } from "@/lib/award-points";
import { syncInventoryToChannelsSafe } from "@/lib/channels/sync-inventory";
import { orderQualifiesForDeferredBuyerPoints } from "@/lib/store-order-buyer-points";
import { applyStoreItemDecrementAfterSale } from "@/lib/store-item-inventory-sale";
import { shouldMarkStoreItemSoldOut } from "@/lib/store-item-variants";
import {
  cancelPendingOrdersForSoldOutItems,
  cleanupOtherBuyersCartsForStoreItems,
  validateBatchStoreOrdersInventory,
} from "@/lib/post-sale-inventory-cleanup";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
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

type FulfillOptions = {
  /** When set (app success return), only fulfill orders owned by this buyer. */
  buyerId?: string;
  logPrefix?: string;
};

/**
 * Mark pending storefront orders paid, transfer to sellers, decrement inventory, sync channels.
 * Idempotent: skips orders that are no longer pending. Safe to call from webhook and success-summary.
 */
export async function fulfillStoreOrdersFromCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  options: FulfillOptions = {}
): Promise<{ orderIds: string[] }> {
  const log = options.logPrefix ?? "[storefront-fulfill]";
  if (session.mode !== "payment") return { orderIds: [] };

  const meta = session.metadata ?? {};
  const toProcess = orderIdsFromCheckoutSessionMetadata(
    meta as Record<string, string | null | undefined>
  );
  if (toProcess.length === 0) return { orderIds: [] };

  if (session.payment_status !== "paid") {
    return { orderIds: toProcess };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : typeof session.payment_intent === "object" && session.payment_intent && "id" in session.payment_intent
        ? session.payment_intent.id
        : null;

  const ordersToFulfill = [];
  for (const orderId of toProcess) {
    const order = await prisma.storeOrder.findFirst({
      where: {
        id: orderId,
        status: "pending",
        ...(options.buyerId ? { buyerId: options.buyerId } : {}),
      },
      include: { items: true },
    });
    if (order) ordersToFulfill.push(order);
  }

  if (ordersToFulfill.length === 0) {
    return { orderIds: toProcess };
  }

  console.info(`${log} fulfilling ${ordersToFulfill.length} pending order(s)`, {
    sessionId: session.id,
    orderIds: ordersToFulfill.map((o) => o.id),
  });

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
      console.error(`${log} refund failed (inventory)`, refundErr);
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
    return { orderIds: toProcess };
  }

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
      console.error(`${log} retrieve PI for Connect transfer:`, piErr);
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
    console.error(`${log} Connect transfer failed:`, transferErr);
    for (const trId of transfersToReverse) {
      await stripe.transfers
        .createReversal(trId)
        .catch((revErr) => console.error(`${log} transfer reversal failed:`, revErr));
    }
    try {
      if (paymentIntentId) {
        await stripe.refunds.create({ payment_intent: paymentIntentId });
      }
    } catch (refundErr) {
      console.error(`${log} refund after transfer failure:`, refundErr);
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
    return { orderIds: toProcess };
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
          syncInventoryToChannelsSafe(oi.storeItemId);
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
        select: { condition: true },
      });
      const allResale =
        storeItems.length === storeItemIds.length && storeItems.every((s) => s.condition === "used");
      if (allResale) {
        const sellerPoints = Math.round(totalCents / 100);
        await awardPoints(order.sellerId, sellerPoints);
      }
    }

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

  return { orderIds: toProcess };
}
