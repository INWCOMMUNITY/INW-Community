import Stripe from "stripe";
import {
  assertLegacyInteractiveMutationAllowed,
  commerceInventoryWriterRoute,
  ensureFoundationStorefrontRefundOperation,
  FoundationRefundIntentConflictError,
  FoundationTransferRefundBlockedError,
  foundationStorefrontRefundIdempotencyKey,
  getCommerceFoundationCutoverState,
  lockFoundationPayoutOutForRefund,
  persistFoundationRefundOutcome,
  persistFoundationRefundSuccess,
  prisma,
} from "database";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { computeSellerTransferCents } from "@/lib/storefront-payout";
import {
  fullRefundChargeCents,
  returnRefundAmountCents,
  sellerLedgerDebitForReturnCents,
  sellerTransferReversalCents,
} from "@/lib/store-return";
import { timestampsFromStripeRefund } from "@/lib/store-order-refund-status";

export function refundAmountCents(order: { totalCents: number; taxCents?: number | null }): number {
  return fullRefundChargeCents(order);
}

export function sellerLedgerDebitCents(order: {
  totalCents: number;
  subtotalCents: number;
}): number {
  return computeSellerTransferCents(order.totalCents, order.subtotalCents).sellerTransferCents;
}

async function reverseConnectTransfer(
  stripe: Stripe,
  transferId: string,
  amountCents?: number
): Promise<void> {
  try {
    if (amountCents != null && amountCents <= 0) return;
    if (amountCents != null) {
      await stripe.transfers.createReversal(transferId, { amount: amountCents });
      return;
    }
    await stripe.transfers.createReversal(transferId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already been reversed|no such transfer/i.test(msg)) return;
    throw e;
  }
}

type LedgerTx = {
  sellerBalance: {
    upsert: (args: {
      where: { memberId: string };
      create: { memberId: string; balanceCents: number; totalEarnedCents: number };
      update: { balanceCents: { decrement: number } };
    }) => Promise<unknown>;
  };
  sellerBalanceTransaction: {
    create: (args: {
      data: {
        memberId: string;
        type: string;
        amountCents: number;
        orderId: string;
        description: string;
      };
    }) => Promise<unknown>;
  };
};

async function debitSellerLedgerForRefund(
  tx: LedgerTx,
  order: { id: string; sellerId: string; totalCents: number; subtotalCents: number },
  debitCents?: number
): Promise<void> {
  const debit = debitCents ?? sellerLedgerDebitCents(order);
  if (debit <= 0) return;
  await tx.sellerBalance.upsert({
    where: { memberId: order.sellerId },
    create: {
      memberId: order.sellerId,
      balanceCents: -debit,
      totalEarnedCents: 0,
    },
    update: { balanceCents: { decrement: debit } },
  });
  await tx.sellerBalanceTransaction.create({
    data: {
      memberId: order.sellerId,
      type: "return",
      amountCents: -debit,
      orderId: order.id,
      description: `Refund: Order #${order.id.slice(-6)}`,
    },
  });
}

function storefrontRefundKind(args: {
  restock?: boolean;
  restockKind?: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION";
  restockOperationId?: string;
  amountCents?: number;
  fullAmountCents: number;
}): "FULL" | "PARTIAL" | "COURTESY" | "RETURN" {
  if (args.restock === false) return "COURTESY";
  if (args.restockKind === "PHYSICAL_RECEIPT" || args.restockOperationId) return "RETURN";
  if (args.amountCents != null && args.amountCents < args.fullAmountCents) return "PARTIAL";
  return "FULL";
}

function isUnknownRefundProviderOutcome(err: unknown): boolean {
  const e = err as { type?: string; statusCode?: number; message?: string };
  const msg = `${typeof e?.message === "string" ? e.message : String(err ?? "")}`;
  if (e?.type === "StripeConnectionError" || e?.type === "StripeAPIError" || e?.type === "StripeRateLimitError") {
    return true;
  }
  const status = e?.statusCode;
  if (status === 0 || (typeof status === "number" && status >= 500)) return true;
  return /timeout|ECONNRESET|ETIMEDOUT|network|socket/i.test(msg);
}

function isStripeRefundAlreadyRefunded(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /already been refunded|charge already refunded/i.test(msg);
}

function isStripeRefundIdempotencyMismatch(err: unknown): boolean {
  const e = err as { type?: string; message?: string };
  const msg = `${typeof e?.message === "string" ? e.message : String(err ?? "")}`;
  return (
    e?.type === "StripeIdempotencyError" ||
    /keys for idempotent requests|idempotent requests can only be used with the same parameters|idempotency(?: key)?(?: parameter)? mismatch/i.test(
      msg
    )
  );
}

/**
 * Refund a paid storefront order on the **platform** account (facilitator Checkout),
 * reverse the Connect transfer when present, optionally restock, and flip sold_out → active.
 */
export async function refundPaidStorefrontOrder(args: {
  stripe: Stripe;
  order: {
    id: string;
    sellerId: string;
    status: string;
    totalCents: number;
    subtotalCents: number;
    taxCents?: number | null;
    stripePaymentIntentId: string | null;
    stripeSellerTransferId?: string | null;
    items: Array<{
      id?: string;
      storeItemId: string;
      quantity: number;
      variant?: unknown;
      variantId?: string | null;
    }>;
  };
  reason?: string;
  note?: string | null;
  /** Override Stripe refund amount. Defaults to full charge (item + tax). */
  amountCents?: number;
  /** Override Connect transfer reversal. Defaults to the full original transfer. */
  transferReversalCents?: number;
  /** Override My Funds debit. Defaults to the full original seller transfer. */
  ledgerDebitCents?: number;
  /** When false, buyer keeps the item (courtesy refund). Default true. */
  restock?: boolean;
  restockOperationId?: string;
  restockKind?: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION";
}): Promise<{ ok: true; refunded: true; amountCents: number } | { ok: false; error: string; status: number }> {
  const { stripe, order } = args;
  if (order.status === "refunded") {
    return { ok: false, error: "Order already refunded", status: 400 };
  }
  if (!order.stripePaymentIntentId) {
    return { ok: false, error: "Order has no payment to refund", status: 400 };
  }

  const amount = args.amountCents ?? refundAmountCents(order);
  if (amount <= 0) {
    return { ok: false, error: "Refund amount must be greater than zero", status: 400 };
  }

  const originalTransfer = sellerLedgerDebitCents(order);
  const reversalAmount = args.transferReversalCents ?? originalTransfer;

  const cutover = await getCommerceFoundationCutoverState(prisma);
  const writerRoute = commerceInventoryWriterRoute(cutover.mode);

  let reversalTransferId: string | null = order.stripeSellerTransferId ?? null;
  let skipSellerLedgerDebit = false;

  if (writerRoute === "foundation") {
    try {
      const guard = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
      if (guard.kind === "TRANSFER_SUCCEEDED") {
        reversalTransferId = guard.stripeTransferId;
      } else {
        reversalTransferId = null;
        skipSellerLedgerDebit = true;
      }
    } catch (e) {
      if (e instanceof FoundationTransferRefundBlockedError) {
        return {
          ok: false,
          error:
            e.disposition === "TRANSFER_IN_FLIGHT" || e.disposition === "TRANSFER_UNCERTAIN"
              ? "Seller payout is unresolved; operator reconciliation is required before refund."
              : e.message,
          status: 409,
        };
      }
      throw e;
    }
  }

  if (reversalTransferId) {
    try {
      await reverseConnectTransfer(
        stripe,
        reversalTransferId,
        args.transferReversalCents != null ? reversalAmount : undefined
      );
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not reverse seller transfer",
        status: 500,
      };
    }
  }

  const refundParams = {
    payment_intent: order.stripePaymentIntentId,
    amount,
    reason: "requested_by_customer" as const,
  };
  const durableRefundKey = foundationStorefrontRefundIdempotencyKey(order.id);
  let refundAction: "provider_create" | "already_succeeded" = "provider_create";
  let refundKey = durableRefundKey;
  let existingStripeRefundId: string | null = null;

  if (writerRoute === "foundation") {
    try {
      const refundIntent = await ensureFoundationStorefrontRefundOperation(prisma, {
        storeOrderId: order.id,
        memberId: order.sellerId,
        amountCents: amount,
        currency: "usd",
        kind: storefrontRefundKind({
          restock: args.restock,
          restockKind: args.restockKind,
          restockOperationId: args.restockOperationId,
          amountCents: args.amountCents,
          fullAmountCents: refundAmountCents(order),
        }),
        restockRequested: args.restock !== false,
        reason: args.reason ?? null,
      });
      refundAction = refundIntent.action;
      refundKey = refundIntent.operation.providerIdempotencyKey;
      existingStripeRefundId = refundIntent.operation.stripeRefundId;
    } catch (e) {
      if (e instanceof FoundationRefundIntentConflictError) {
        return { ok: false, error: e.message, status: 409 };
      }
      throw e;
    }
  }

  const refundRequestOptions = { idempotencyKey: refundKey };

  let stripeRefund: { id?: string; status?: string | null; created?: number } | null = null;
  if (refundAction === "already_succeeded" && existingStripeRefundId) {
    stripeRefund = { id: existingStripeRefundId, status: "succeeded" };
  } else {
    try {
      stripeRefund = await stripe.refunds.create(refundParams, refundRequestOptions);
    } catch (e) {
      if (isStripeRefundAlreadyRefunded(e)) {
        try {
          const existing = await stripe.refunds.list({
            payment_intent: order.stripePaymentIntentId,
            limit: 1,
          });
          stripeRefund = existing.data[0] ?? null;
        } catch {
          stripeRefund = null;
        }
      } else {
        const msg = e instanceof Error ? e.message : "Refund failed";
        const outcomeStatus = isUnknownRefundProviderOutcome(e) || isStripeRefundIdempotencyMismatch(e)
          ? "UNCERTAIN"
          : "FAILED";
        if (writerRoute === "foundation") {
          await persistFoundationRefundOutcome(prisma, {
            storeOrderId: order.id,
            status: outcomeStatus,
            lastError: msg,
          }).catch(() => {});
        }
        return {
          ok: false,
          error: isStripeRefundIdempotencyMismatch(e)
            ? "Refund request parameters conflict with the existing refund operation"
            : msg,
          status: isStripeRefundIdempotencyMismatch(e) ? 409 : 500,
        };
      }
    }
  }

  if (stripeRefund?.id) {
    if (writerRoute === "foundation") {
      try {
        await persistFoundationRefundSuccess(prisma, {
          storeOrderId: order.id,
          stripeRefundId: stripeRefund.id,
        });
      } catch (e) {
        if (e instanceof FoundationRefundIntentConflictError) {
          return { ok: false, error: e.message, status: 409 };
        }
        await persistFoundationRefundOutcome(prisma, {
          storeOrderId: order.id,
          status: "UNCERTAIN",
          lastError: e instanceof Error ? e.message : "persist_refund_success_failed",
        }).catch(() => {});
        return { ok: false, error: "Refund provider outcome is uncertain; retry the same refund", status: 500 };
      }
    }
  } else if (refundAction !== "already_succeeded") {
    if (writerRoute === "foundation") {
      await persistFoundationRefundOutcome(prisma, {
        storeOrderId: order.id,
        status: "UNCERTAIN",
        lastError: "refund_id_missing_after_provider",
      }).catch(() => {});
    }
    return { ok: false, error: "Refund provider outcome is uncertain; retry the same refund", status: 500 };
  }

  const refundTimes = stripeRefund
    ? timestampsFromStripeRefund(stripeRefund)
    : { stripeRefundId: undefined, refundInitiatedAt: new Date(), refundCompletedAt: null };

  const shouldRestock = args.restock !== false;
  await prisma.$transaction(async (tx) => {
    await tx.storeOrder.update({
      where: { id: order.id },
      data: {
        status: "refunded",
        cancelReason: args.reason,
        cancelNote: args.note ?? undefined,
        inventoryRestoredAt: shouldRestock ? new Date() : undefined,
        stripeRefundId: refundTimes.stripeRefundId,
        refundInitiatedAt: refundTimes.refundInitiatedAt,
        refundCompletedAt: refundTimes.refundCompletedAt ?? undefined,
      },
    });
    if (shouldRestock) {
      const operationId =
        args.restockOperationId ??
        (stripeRefund?.id ? `stripe-refund:${stripeRefund.id}` : `refund:${order.id}`);
      await restockOrderLinesAfterReturn(
        tx,
        order.items,
        args.restockKind ?? "UNDO_CONSUMPTION",
        operationId
      );
    }
    if (!skipSellerLedgerDebit) {
      await debitSellerLedgerForRefund(tx, order, args.ledgerDebitCents);
    }
  });

  return { ok: true, refunded: true, amountCents: amount };
}

export function refundArgsFromReturnPolicy(order: {
  totalCents: number;
  subtotalCents: number;
  taxCents?: number | null;
}, policy: { chargeReturnShipping: boolean; returnLabelCostCents?: number | null }): {
  amountCents: number;
  transferReversalCents: number;
  ledgerDebitCents: number;
} {
  const originalTransfer = sellerLedgerDebitCents(order);
  return {
    amountCents: returnRefundAmountCents({
      totalCents: order.totalCents,
      taxCents: order.taxCents,
      chargeReturnShipping: policy.chargeReturnShipping,
      returnLabelCostCents: policy.returnLabelCostCents,
    }),
    transferReversalCents: sellerTransferReversalCents({
      originalTransferCents: originalTransfer,
      chargeReturnShipping: policy.chargeReturnShipping,
      returnLabelCostCents: policy.returnLabelCostCents,
    }),
    ledgerDebitCents: sellerLedgerDebitForReturnCents({
      originalDebitCents: originalTransfer,
      chargeReturnShipping: policy.chargeReturnShipping,
      returnLabelCostCents: policy.returnLabelCostCents,
    }),
  };
}

/** Dashboard / charge.refunded / dispute: reverse Connect transfer, debit ledger, restock once. */
export async function restockAfterExternalRefund(
  orderId: string,
  stripe?: Stripe | null
): Promise<boolean> {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return false;
  if (order.inventoryRestoredAt) return false;
  if (!["paid", "shipped", "delivered"].includes(order.status) && order.status !== "refunded") {
    return false;
  }

  const cutover = await getCommerceFoundationCutoverState(prisma);
  if (commerceInventoryWriterRoute(cutover.mode) !== "legacy") {
    if (commerceInventoryWriterRoute(cutover.mode) === "foundation") {
      try {
        const guard = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
        if (guard.kind === "TRANSFER_SUCCEEDED" && stripe) {
          await reverseConnectTransfer(stripe, guard.stripeTransferId);
        }
      } catch (e) {
        if (e instanceof FoundationTransferRefundBlockedError) {
          return false;
        }
        throw e;
      }
    } else {
      await assertLegacyInteractiveMutationAllowed(prisma);
    }
  } else {
    await assertLegacyInteractiveMutationAllowed(prisma);
  }

  if (commerceInventoryWriterRoute(cutover.mode) !== "foundation" && stripe && order.stripeSellerTransferId) {
    await reverseConnectTransfer(stripe, order.stripeSellerTransferId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.storeOrder.update({
      where: { id: order.id },
      data: {
        status: "refunded",
        inventoryRestoredAt: new Date(),
        cancelReason: order.cancelReason ?? "Refunded in Stripe",
        refundInitiatedAt: order.refundInitiatedAt ?? new Date(),
      },
    });
    await restockOrderLinesAfterReturn(tx, order.items, "UNDO_CONSUMPTION", `external-refund:${order.id}`);
    await debitSellerLedgerForRefund(tx, order);
  });
  return true;
}
