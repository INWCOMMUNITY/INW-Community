import Stripe from "stripe";
import {
  beginFoundationTransferAttempt,
  classifyStripeTransferFailure,
  completeFoundationSellerPayoutLedger,
  commerceInventoryWriterRoute,
  ensureFoundationTransferIntents,
  finalizeFoundationCheckoutPayment,
  foundationSellerPayoutRecoveryWhere,
  getCommerceFoundationCutoverState,
  isPermanentFoundationNonconvertibleError,
  isRetryableFoundationCommerceError,
  markFoundationAttemptUnfulfillable,
  markFoundationStoreOrderPaidAfterConvert,
  persistFoundationTransferOutcome,
  persistFoundationTransferSuccess,
  prisma,
} from "database";
import { applyStoreItemDecrementAfterSale } from "@/lib/store-item-inventory-sale";
import { shouldMarkStoreItemSoldOut } from "@/lib/store-item-variants";
import {
  cancelPendingOrdersForSoldOutItems,
  cleanupOtherBuyersCartsForStoreItems,
  validateBatchStoreOrdersInventory,
} from "@/lib/post-sale-inventory-cleanup";
import { orderIdsFromCheckoutSessionMetadata } from "@/lib/stripe-checkout-order-ids";
import {
  shippingAddressFromCheckoutSession,
  storeOrderNeedsShippingBackfill,
} from "@/lib/stripe-checkout-session-shipping";
import {
  allocateTaxCentsAcrossOrders,
  assertPreTaxSplitMatchesOrderTotal,
  assertSessionSubtotalMatchesOrderTotals,
  computeSellerTransferCents,
} from "@/lib/storefront-payout";
import { SOLD_BEFORE_CHECKOUT_REASON } from "@/lib/store-order-cancel-reasons";

type FulfillOptions = {
  /** When set (app success return), only fulfill orders owned by this buyer. */
  buyerId?: string;
  logPrefix?: string;
};

/**
 * Placeholder for post-sale inventory sync.
 * Channel sync functionality has been removed - this is now a no-op.
 */
export async function syncStoreItemsAfterSale(
  _storeItemIds: Iterable<string>,
  _logPrefix: string
): Promise<void> {
  // Channel sync has been removed
}

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

  const cutover = await getCommerceFoundationCutoverState(prisma);
  const writerRoute = commerceInventoryWriterRoute(cutover.mode);

  const ordersToFulfill = [];
  for (const orderId of toProcess) {
    const order = await prisma.storeOrder.findFirst({
      where: {
        id: orderId,
        ...(options.buyerId ? { buyerId: options.buyerId } : {}),
        ...(writerRoute === "foundation" ? foundationSellerPayoutRecoveryWhere() : { status: "pending" }),
      },
      include: { items: true },
    });
    if (order) ordersToFulfill.push(order);
  }

  if (ordersToFulfill.length === 0) {
    // Idempotent re-entry: the Stripe webhook and the app success-return both fulfill the same
    // checkout. Whichever runs second finds the order already `paid` and would otherwise return
    // without pushing inventory — so if the first pass's channel sync was skipped or failed, Wix
    // (etc.) stays stale until a manual push. Always retry the inventory push for paid orders.
    if (session.payment_status === "paid" && toProcess.length > 0) {
      const paidOrders = await prisma.storeOrder.findMany({
        where: { id: { in: toProcess }, status: "paid" },
        include: { items: true },
      });
      await syncStoreItemsAfterSale(
        paidOrders.flatMap((o) => o.items.map((i) => i.storeItemId)),
        log
      );
    }
    return { orderIds: toProcess };
  }

  if (writerRoute !== "foundation") {
    for (const order of ordersToFulfill) {
      const { assertLegacyDrainFinalizerAllowed } = await import("database");
      await assertLegacyDrainFinalizerAllowed(prisma, order.createdAt);
    }
  }

  console.info(`${log} fulfilling ${ordersToFulfill.length} pending order(s)`, {
    sessionId: session.id,
    orderIds: ordersToFulfill.map((o) => o.id),
  });

  // FOUNDATION already held inventory at checkout. StoreItem.quantity is a compatibility
  // projection (available), so a fully reserved last unit would look like 0 and must not
  // trigger a sold-before-checkout refund.
  if (writerRoute !== "foundation") {
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
          cancelReason: SOLD_BEFORE_CHECKOUT_REASON,
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
  }

  const allSoldOutIds = new Set<string>();
  const allPurchasedIds = new Set<string>();
  const storeItemIdsToSyncChannels = new Set<string>();
  const titleByItemId = new Map<string, string>();
  const sessionAmountSubtotal = session.amount_subtotal ?? 0;
  const sessionTaxCents = session.total_details?.amount_tax ?? 0;

  assertSessionSubtotalMatchesOrderTotals(
    ordersToFulfill.map((o) => ({ id: o.id, totalCents: o.totalCents })),
    session.amount_subtotal
  );

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

  if (writerRoute === "foundation") {
    await fulfillFoundationPendingOrders({
      stripe,
      session,
      ordersToFulfill,
      payoutByOrderId,
      log,
      paymentIntentId,
    });
    return { orderIds: toProcess };
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
          taxCents: payout.orderTaxCents,
          salesTaxReserveCents: payout.salesTaxReserveCents,
          platformFeeCents: payout.platformFeeCents,
          ...backfillShipping,
          ...(transferIdByOrderId.has(order.id)
            ? { stripeSellerTransferId: transferIdByOrderId.get(order.id) }
            : {}),
        },
      });

      for (const oi of order.items) {
        allPurchasedIds.add(oi.storeItemId);
        const storeItem = await prisma.storeItem.findUnique({
          where: { id: oi.storeItemId },
        });
        if (storeItem) titleByItemId.set(oi.storeItemId, storeItem.title);
        if (storeItem) {
          await applyStoreItemDecrementAfterSale(
            prisma,
            storeItem,
            {
              quantity: oi.quantity,
              variant: oi.variant,
            },
            { startedAt: order.createdAt }
          );
        }
        const updated = await prisma.storeItem.findUnique({
          where: { id: oi.storeItemId },
          select: { quantity: true, variants: true, inventoryTracking: true },
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
        storeItemIdsToSyncChannels.add(oi.storeItemId);
      }

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

    if (storeItemIdsToSyncChannels.size > 0) {
      await syncStoreItemsAfterSale(storeItemIdsToSyncChannels, log);
    }
  }

  return { orderIds: toProcess };
}

export async function ensureFoundationPayoutIntentsForAttempt(attemptId: string): Promise<void> {
  const orders = await prisma.storeOrder.findMany({
    where: { checkoutAttemptId: attemptId },
    select: { id: true, sellerId: true, totalCents: true, subtotalCents: true },
  });
  const inputs = orders
    .map((order) => {
      const payout = computeSellerTransferCents(order.totalCents, order.subtotalCents);
      if (payout.sellerTransferCents <= 0) return null;
      return {
        storeOrderId: order.id,
        memberId: order.sellerId,
        amountCents: payout.sellerTransferCents,
        currency: "usd",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  await ensureFoundationTransferIntents(prisma, inputs);
}

type FoundationPayoutRow = {
  platformFeeCents: number;
  salesTaxReserveCents: number;
  sellerTransferCents: number;
  orderTaxCents: number;
  sellerCreditsCents: number;
};

async function retrieveChargeId(stripe: Stripe, paymentIntentId: string | null, log: string): Promise<string | null> {
  if (!paymentIntentId) return null;
  try {
    const piRetrieved = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const ch = piRetrieved.latest_charge;
    return typeof ch === "string"
      ? ch
      : ch && typeof ch === "object" && "id" in ch
        ? (ch as Stripe.Charge).id
        : null;
  } catch (piErr) {
    console.error(`${log} retrieve PI for Connect transfer:`, piErr);
    return null;
  }
}

async function fulfillFoundationPendingOrders(args: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  ordersToFulfill: Array<{
    id: string;
    buyerId: string;
    sellerId: string;
    totalCents: number;
    subtotalCents: number;
    checkoutAttemptId?: string | null;
    commerceStatus?: string | null;
    shippingAddress: unknown;
    items: Array<{ storeItemId: string; quantity: number; variant?: unknown; fulfillmentType?: string | null }>;
  }>;
  payoutByOrderId: Map<string, FoundationPayoutRow>;
  log: string;
  paymentIntentId: string | null;
}): Promise<void> {
  const { stripe, session, ordersToFulfill, payoutByOrderId, log, paymentIntentId } = args;
  const attemptId = ordersToFulfill.find((o) => o.checkoutAttemptId)?.checkoutAttemptId;
  if (!attemptId) {
    throw new Error("FOUNDATION fulfill is missing CheckoutAttempt");
  }

  if (ordersToFulfill.some((order) => order.commerceStatus === "UNFULFILLABLE")) {
    console.info(`${log} foundation attempt already UNFULFILLABLE; skip CONVERT and seller transfers`, {
      attemptId,
    });
    return;
  }

  const intentInputs = ordersToFulfill
    .map((order) => {
      const payout = payoutByOrderId.get(order.id);
      if (!payout || payout.sellerTransferCents <= 0) return null;
      return {
        storeOrderId: order.id,
        memberId: order.sellerId,
        amountCents: payout.sellerTransferCents,
        currency: "usd",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  await ensureFoundationTransferIntents(prisma, intentInputs);

  try {
    await finalizeFoundationCheckoutPayment(prisma, {
      attemptId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
    });
  } catch (err) {
    if (isPermanentFoundationNonconvertibleError(err)) {
      await markFoundationAttemptUnfulfillable(prisma, attemptId);
      console.info(`${log} foundation commerce unfulfillable; zero seller transfers`, {
        attemptId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (isRetryableFoundationCommerceError(err) || !isPermanentFoundationNonconvertibleError(err)) {
      throw err;
    }
    throw err;
  }

  const allPurchasedIds = [...new Set(ordersToFulfill.flatMap((o) => o.items.map((i) => i.storeItemId)))];
  const buyerId = ordersToFulfill[0].buyerId;
  await cleanupOtherBuyersCartsForStoreItems({
    winningBuyerId: buyerId,
    purchasedStoreItemIds: allPurchasedIds,
  });
  await prisma.cartItem.deleteMany({
    where: { memberId: buyerId, storeItemId: { in: allPurchasedIds } },
  });

  const chargeId = await retrieveChargeId(stripe, paymentIntentId, log);
  const sellerIdList = [...new Set(ordersToFulfill.map((o) => o.sellerId))];
  const sellerRows = await prisma.member.findMany({
    where: { id: { in: sellerIdList } },
    select: { id: true, stripeConnectAccountId: true },
  });
  const connectBySellerId = new Map(sellerRows.map((r) => [r.id, r.stripeConnectAccountId?.trim() ?? ""]));
  const shipFromStripe = shippingAddressFromCheckoutSession(session);

  for (const order of ordersToFulfill) {
    const payout = payoutByOrderId.get(order.id);
    if (!payout) continue;
    const backfillShipping =
      shipFromStripe && storeOrderNeedsShippingBackfill(order)
        ? { shippingAddress: shipFromStripe as object }
        : {};

    await markFoundationStoreOrderPaidAfterConvert(prisma, {
      storeOrderId: order.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      taxCents: payout.orderTaxCents,
      salesTaxReserveCents: payout.salesTaxReserveCents,
      platformFeeCents: payout.platformFeeCents,
      shippingAddress: backfillShipping.shippingAddress ?? null,
    });

    if (payout.sellerTransferCents <= 0) {
      continue;
    }

    const existingOp = await prisma.transferOperation.findUnique({
      where: { storeOrderId: order.id },
      select: { status: true, retryCount: true, stripeTransferId: true },
    });
    const connectId = connectBySellerId.get(order.sellerId);
    const neverAttempted = !existingOp || (existingOp.status === "PENDING" && existingOp.retryCount === 0);
    if ((!connectId || !chargeId) && neverAttempted && !existingOp?.stripeTransferId) {
      await persistFoundationTransferOutcome(prisma, {
        storeOrderId: order.id,
        status: "FAILED",
        lastError: !connectId ? "missing_connect_account" : "missing_charge",
      });
      continue;
    }

    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    if (began.action === "already_succeeded") {
      try {
        await completeFoundationSellerPayoutLedger(prisma, {
          storeOrderId: order.id,
          sellerCreditsCents: payout.sellerCreditsCents,
        });
      } catch (paidErr) {
        console.error(`${log} seller ledger after SUCCEEDED transfer failed`, paidErr);
      }
      continue;
    }
    if (began.action !== "provider_create") {
      console.info(`${log} foundation transfer not attempted`, {
        storeOrderId: order.id,
        action: began.action,
        reason: began.action === "operator_required" ? began.reason : began.action,
      });
      continue;
    }

    if (!connectId || !chargeId) {
      await persistFoundationTransferOutcome(prisma, {
        storeOrderId: order.id,
        status: "FAILED",
        lastError: !connectId ? "missing_connect_account" : "missing_charge",
      });
      continue;
    }

    try {
      const tr = await stripe.transfers.create(
        {
          amount: began.operation.amountCents,
          currency: began.operation.currency,
          destination: connectId,
          source_transaction: chargeId,
          metadata: { orderId: order.id, transferOperationId: began.operation.id },
        },
        { idempotencyKey: began.operation.providerIdempotencyKey }
      );
      try {
        await persistFoundationTransferSuccess(prisma, {
          storeOrderId: order.id,
          stripeTransferId: tr.id,
        });
      } catch (persistErr) {
        console.error(`${log} persist transfer success failed`, persistErr);
        await persistFoundationTransferOutcome(prisma, {
          storeOrderId: order.id,
          status: "UNCERTAIN",
          lastError: persistErr instanceof Error ? persistErr.message : "persist_success_failed",
        }).catch((outcomeErr) => {
          console.error(`${log} persist UNCERTAIN after success persist failure:`, outcomeErr);
        });
        continue;
      }
      try {
        await completeFoundationSellerPayoutLedger(prisma, {
          storeOrderId: order.id,
          sellerCreditsCents: payout.sellerCreditsCents,
        });
      } catch (paidErr) {
        console.error(`${log} seller ledger after SUCCEEDED transfer failed`, paidErr);
      }
    } catch (transferErr) {
      const kind = classifyStripeTransferFailure(transferErr);
      console.error(`${log} foundation Connect transfer ${kind}:`, transferErr);
      await persistFoundationTransferOutcome(prisma, {
        storeOrderId: order.id,
        status: kind === "failed" ? "FAILED" : "UNCERTAIN",
        lastError: transferErr instanceof Error ? transferErr.message : String(transferErr),
      });
    }
  }
}
