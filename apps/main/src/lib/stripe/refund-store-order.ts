import Stripe from "stripe";
import {
  assertLegacyInteractiveMutationAllowed,
  classifySellerBalanceLedgerEvidence,
  commerceInventoryWriterRoute,
  ensureFoundationStorefrontRefundOperation,
  FoundationRefundIntentConflictError,
  FoundationTransferRefundBlockedError,
  foundationStorefrontRefundIdempotencyKey,
  getCommerceFoundationCutoverState,
  isFoundationReturnLedgerAnomaly,
  loadHistoricalRefundRuntimeDecision,
  lockFoundationPayoutOutForRefund,
  mustBlockHistoricalSellerFinancialMutation,
  persistFoundationRefundOutcome,
  persistFoundationRefundSuccess,
  prisma,
  runHistoricalExternalRefundRestockBranch,
} from "database";
import { restockOrderLinesAfterReturn } from "@/lib/store-item-restock";
import { computeSellerTransferCents } from "@/lib/storefront-payout";
import {
  buyerRefundCentsForFeeBearer,
  nonRefundableStripeFeeCents,
  returnRefundAmountCents,
  sellerLedgerDebitForReturnCents,
  sellerTransferReversalCents,
  type StorefrontStripeFeeBearer,
} from "@/lib/store-return";
import { timestampsFromStripeRefund } from "@/lib/store-order-refund-status";

/** Default buyer-initiated refund (Stripe fees deducted from the card refund). */
export function refundAmountCents(order: { totalCents: number; taxCents?: number | null }): number {
  return buyerRefundCentsForFeeBearer(order, "buyer");
}

export function sellerLedgerDebitCents(order: {
  totalCents: number;
  subtotalCents: number;
  taxCents?: number | null;
}): number {
  return computeSellerTransferCents(
    order.totalCents,
    order.subtotalCents,
    order.taxCents ?? 0
  ).sellerTransferCents;
}

/** My Funds debit: original transfer, plus Stripe fees when the seller bears them. */
export function sellerLedgerDebitCentsForFeeBearer(
  order: {
    totalCents: number;
    subtotalCents: number;
    taxCents?: number | null;
  },
  bearer: StorefrontStripeFeeBearer
): number {
  const transfer = sellerLedgerDebitCents(order);
  if (bearer !== "seller") return transfer;
  return transfer + nonRefundableStripeFeeCents(order);
}

export const STOREFRONT_TRANSFER_REVERSAL_IDEMPOTENCY_PREFIX = "nwc_store_reversal_";
const STOREFRONT_TRANSFER_REVERSAL_PAGE_SIZE = 100;
const STOREFRONT_TRANSFER_REVERSAL_MAX_PAGES = 5;

/**
 * Include amount so a clamped retry does not collide with a prior failed over-request
 * that burned the order-only key (Stripe idempotency keys bind to first parameters).
 */
export function storefrontTransferReversalIdempotencyKey(
  storeOrderId: string,
  amountCents: number
): string {
  return `${STOREFRONT_TRANSFER_REVERSAL_IDEMPOTENCY_PREFIX}${storeOrderId}_${amountCents}`;
}

export type StorefrontTransferReversalStatus =
  | "already_reversed"
  | "reversed"
  | "skipped"
  | "uncertain"
  | "failed"
  | "conflict";

export type StorefrontTransferReversalResult = {
  status: StorefrontTransferReversalStatus;
  reversalId?: string;
  /** Amount actually reversed (or already reversed / skipped as 0). */
  amountCents?: number;
  error?: string;
};

/** Cap a requested reverse to what Stripe still allows on the transfer. */
export function clampStorefrontTransferReversalCents(
  requestedCents: number,
  transfer: { amount: number; amount_reversed?: number | null }
): number {
  const remaining = Math.max(0, transfer.amount - Math.max(0, transfer.amount_reversed ?? 0));
  return Math.max(0, Math.min(Math.max(0, requestedCents), remaining));
}

type ListedTransferReversal = {
  id: string;
  amount: number;
  metadata?: Stripe.Metadata | null;
};

function causalStorefrontReversalMetadata(args: {
  storeOrderId: string;
  refundOperationId?: string | null;
}): Record<string, string> {
  const metadata: Record<string, string> = { storeOrderId: args.storeOrderId };
  const refundOperationId = args.refundOperationId?.trim();
  if (refundOperationId) metadata.refundOperationId = refundOperationId;
  return metadata;
}

function isCausalStorefrontReversal(
  reversal: ListedTransferReversal,
  storeOrderId: string,
  refundOperationId?: string | null
): boolean {
  const meta = reversal.metadata ?? {};
  if (meta.storeOrderId !== storeOrderId) return false;
  const expectedRo = refundOperationId?.trim();
  const actualRo = meta.refundOperationId;
  if (expectedRo && actualRo && actualRo !== expectedRo) return false;
  return true;
}

type StorefrontReversalDiscovery =
  | { status: "found"; reversal: ListedTransferReversal }
  | { status: "none" }
  | { status: "ambiguous"; error: string }
  | { status: "lookup_failed"; error: string };

async function findExistingStorefrontTransferReversal(
  stripe: Stripe,
  args: { transferId: string; storeOrderId: string; refundOperationId?: string | null }
): Promise<StorefrontReversalDiscovery> {
  const matches: ListedTransferReversal[] = [];
  let startingAfter: string | undefined;
  try {
    for (let page = 0; page < STOREFRONT_TRANSFER_REVERSAL_MAX_PAGES; page++) {
      const list = await stripe.transfers.listReversals(args.transferId, {
        limit: STOREFRONT_TRANSFER_REVERSAL_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const rows = list.data ?? [];
      for (const row of rows) {
        if (isCausalStorefrontReversal(row, args.storeOrderId, args.refundOperationId)) {
          matches.push({ id: row.id, amount: row.amount, metadata: row.metadata });
        }
      }
      if (!list.has_more) break;
      const lastId = rows[rows.length - 1]?.id;
      if (!lastId) {
        return { status: "lookup_failed", error: "Seller transfer reversal history is incomplete" };
      }
      if (page === STOREFRONT_TRANSFER_REVERSAL_MAX_PAGES - 1) {
        return { status: "lookup_failed", error: "Seller transfer reversal history is incomplete" };
      }
      startingAfter = lastId;
    }
  } catch (e) {
    return {
      status: "lookup_failed",
      error: e instanceof Error ? e.message : "Could not list seller transfer reversals",
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      error: "Multiple seller transfer reversals match this order; operator reconciliation is required",
    };
  }
  if (matches.length === 1) return { status: "found", reversal: matches[0] };
  return { status: "none" };
}

function reversalHttpError(result: StorefrontTransferReversalResult): {
  ok: false;
  error: string;
  status: number;
} {
  return {
    ok: false,
    error: result.error ?? "Could not reverse seller transfer",
    status: result.status === "conflict" ? 409 : 500,
  };
}

export async function ensureStorefrontTransferReversal(
  stripe: Stripe,
  args: {
    transferId: string;
    storeOrderId: string;
    amountCents: number;
    refundOperationId?: string | null;
  }
): Promise<StorefrontTransferReversalResult> {
  if (args.amountCents <= 0) return { status: "skipped", amountCents: 0 };

  let transfer: { amount: number; amount_reversed?: number | null };
  try {
    transfer = await stripe.transfers.retrieve(args.transferId);
  } catch (e) {
    return {
      status: "uncertain",
      error: e instanceof Error ? e.message : "Could not load seller transfer",
    };
  }

  // Recalculated order math can be a few cents above the live transfer (e.g. tax in fee base).
  const amountCents = clampStorefrontTransferReversalCents(args.amountCents, transfer);

  const discovered = await findExistingStorefrontTransferReversal(stripe, args);
  if (discovered.status === "lookup_failed") {
    return { status: "uncertain", error: discovered.error };
  }
  if (discovered.status === "ambiguous") {
    return { status: "conflict", error: discovered.error };
  }
  if (discovered.status === "found") {
    const remaining = Math.max(0, transfer.amount - Math.max(0, transfer.amount_reversed ?? 0));
    const matchesRequested = discovered.reversal.amount === amountCents;
    const matchesFullTransfer = discovered.reversal.amount === transfer.amount;
    const fullyReversedAlready = remaining === 0;
    if (!matchesRequested && !matchesFullTransfer && !fullyReversedAlready) {
      return {
        status: "conflict",
        reversalId: discovered.reversal.id,
        amountCents: discovered.reversal.amount,
        error:
          "Existing seller transfer reversal amount conflicts with this refund; operator reconciliation is required",
      };
    }
    return {
      status: "already_reversed",
      reversalId: discovered.reversal.id,
      amountCents: discovered.reversal.amount,
    };
  }

  if (amountCents <= 0) {
    // Nothing left on the transfer (already reversed elsewhere or zero-value).
    return { status: "skipped", amountCents: 0 };
  }

  const metadata = causalStorefrontReversalMetadata(args);
  const params = { amount: amountCents, metadata };
  const idempotencyKey = storefrontTransferReversalIdempotencyKey(args.storeOrderId, amountCents);

  const acceptRediscovered = (
    rediscovered: Extract<StorefrontReversalDiscovery, { status: "found" }>
  ): StorefrontTransferReversalResult => {
    const remaining = Math.max(0, transfer.amount - Math.max(0, transfer.amount_reversed ?? 0));
    const matchesRequested = rediscovered.reversal.amount === amountCents;
    const matchesFullTransfer = rediscovered.reversal.amount === transfer.amount;
    const fullyReversedAlready = remaining === 0;
    if (!matchesRequested && !matchesFullTransfer && !fullyReversedAlready) {
      return {
        status: "conflict",
        reversalId: rediscovered.reversal.id,
        amountCents: rediscovered.reversal.amount,
        error:
          "Existing seller transfer reversal amount conflicts with this refund; operator reconciliation is required",
      };
    }
    return {
      status: "already_reversed",
      reversalId: rediscovered.reversal.id,
      amountCents: rediscovered.reversal.amount,
    };
  };

  try {
    const created = await stripe.transfers.createReversal(args.transferId, params, {
      idempotencyKey,
    });
    return { status: "reversed", reversalId: created.id, amountCents };
  } catch (e) {
    const rediscovered = await findExistingStorefrontTransferReversal(stripe, args);
    if (rediscovered.status === "found") {
      return acceptRediscovered(rediscovered);
    }

    // Legacy order-only keys may be burned with a different amount/metadata; recover once.
    if (isStripeRefundIdempotencyMismatch(e)) {
      const recoveryKey = `${idempotencyKey}_r`;
      try {
        const created = await stripe.transfers.createReversal(args.transferId, params, {
          idempotencyKey: recoveryKey,
        });
        return { status: "reversed", reversalId: created.id, amountCents };
      } catch (retryErr) {
        const afterRetry = await findExistingStorefrontTransferReversal(stripe, args);
        if (afterRetry.status === "found") {
          return acceptRediscovered(afterRetry);
        }
        const msg =
          retryErr instanceof Error ? retryErr.message : "Could not reverse seller transfer";
        if (isUnknownRefundProviderOutcome(retryErr) || isStripeRefundIdempotencyMismatch(retryErr)) {
          return { status: "uncertain", error: msg };
        }
        return { status: "failed", error: msg };
      }
    }

    const msg = e instanceof Error ? e.message : "Could not reverse seller transfer";
    if (isUnknownRefundProviderOutcome(e)) {
      return { status: "uncertain", error: msg };
    }
    return { status: "failed", error: msg };
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

export class StorefrontReturnLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontReturnLedgerConflictError";
  }
}

export async function persistLocalStorefrontRefundCompletion(input: {
  order: {
    id: string;
    sellerId: string;
    totalCents: number;
    subtotalCents: number;
    inventoryRestoredAt?: Date | string | null;
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
  restock?: boolean;
  restockKind?: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION";
  restockOperationId?: string;
  ledgerDebitCents?: number;
  skipSellerLedgerDebit: boolean;
  stripeRefund: { id?: string; status?: string | null; created?: number } | null;
  locallyComplete?: boolean;
}): Promise<void> {
  const refundTimes = input.stripeRefund
    ? timestampsFromStripeRefund(input.stripeRefund)
    : {
        stripeRefundId: undefined,
        refundInitiatedAt: new Date(),
        refundCompletedAt: input.locallyComplete ? new Date() : null,
      };
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${input.order.id} FOR UPDATE`;
    const locked = await tx.storeOrder.findUnique({
      where: { id: input.order.id },
      select: { id: true, sellerId: true, status: true, inventoryRestoredAt: true },
    });
    if (!locked) {
      throw new Error(`StoreOrder ${input.order.id} not found`);
    }

    const shouldRestock = input.restock !== false && !locked.inventoryRestoredAt;
    let applySellerLedgerDebit = false;
    let ledgerDebit = 0;
    if (!input.skipSellerLedgerDebit) {
      ledgerDebit = input.ledgerDebitCents ?? sellerLedgerDebitCents(input.order);
    }
    const expectPathADebit = !input.skipSellerLedgerDebit && ledgerDebit > 0;

    const returnLedgerRows = await tx.sellerBalanceTransaction.findMany({
      where: { orderId: locked.id, type: "return" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (expectPathADebit) {
      if (locked.sellerId !== input.order.sellerId) {
        throw new StorefrontReturnLedgerConflictError(
          "Existing seller return ledger evidence conflicts with this refund; operator reconciliation is required"
        );
      }
      const evidence = classifySellerBalanceLedgerEvidence({
        expected: {
          expected: true,
          memberId: locked.sellerId,
          amountCents: -ledgerDebit,
          matchStripeTransferId: false,
        },
        rows: returnLedgerRows,
      });
      if (evidence.classification === "MISSING") {
        applySellerLedgerDebit = true;
      } else if (evidence.classification !== "EXACT") {
        throw new StorefrontReturnLedgerConflictError(
          `Existing seller return ledger evidence conflicts with this refund (${evidence.classification}); operator reconciliation is required`
        );
      }
    } else {
      const none = classifySellerBalanceLedgerEvidence({
        expected: { expected: false },
        rows: returnLedgerRows,
      });
      if (isFoundationReturnLedgerAnomaly(none.classification)) {
        throw new StorefrontReturnLedgerConflictError(
          `Existing seller return ledger evidence conflicts with this refund (${none.classification}); operator reconciliation is required`
        );
      }
    }

    if (shouldRestock) {
      const operationId =
        input.restockOperationId ??
        (input.stripeRefund?.id ? `stripe-refund:${input.stripeRefund.id}` : `refund:${input.order.id}`);
      await restockOrderLinesAfterReturn(
        tx,
        input.order.items,
        input.restockKind ?? "UNDO_CONSUMPTION",
        operationId
      );
    }
    if (applySellerLedgerDebit) {
      await debitSellerLedgerForRefund(
        tx,
        { ...input.order, sellerId: locked.sellerId },
        ledgerDebit
      );
    }
    await tx.storeOrder.update({
      where: { id: input.order.id },
      data: {
        status: "refunded",
        cancelReason: input.reason,
        cancelNote: input.note ?? undefined,
        inventoryRestoredAt: shouldRestock ? new Date() : undefined,
        stripeRefundId: refundTimes.stripeRefundId,
        refundInitiatedAt: refundTimes.refundInitiatedAt,
        refundCompletedAt: refundTimes.refundCompletedAt ?? undefined,
      },
    });
  });
}

export function isStorefrontReversalComplete(status: StorefrontTransferReversalStatus): boolean {
  return status === "reversed" || status === "already_reversed" || status === "skipped";
}

export type StorefrontBuyerRefundStripe = {
  id?: string;
  status?: string | null;
  created?: number;
};

export type StorefrontBuyerRefundResult =
  | {
      status: "zero_amount";
      amountCents: 0;
      stripeRefund: null;
      alreadySucceeded: false;
    }
  | {
      status: "succeeded";
      amountCents: number;
      stripeRefund: StorefrontBuyerRefundStripe | null;
      alreadySucceeded: boolean;
    }
  | { status: "uncertain"; error: string; httpStatus: number }
  | { status: "failed"; error: string; httpStatus: number }
  | { status: "conflict"; error: string; httpStatus: number }
  | { status: "replay_window_expired"; error: string; httpStatus: number };

/**
 * Buyer Stripe refund + durable RefundOperation only.
 * Does not reverse a seller transfer, restock inventory, or mutate StoreReturn.
 */
export async function executeStorefrontBuyerRefund(args: {
  stripe: Stripe;
  order: {
    id: string;
    sellerId: string;
    totalCents: number;
    subtotalCents: number;
    taxCents?: number | null;
    stripePaymentIntentId: string | null;
  };
  amountCents: number;
  reason?: string;
  restock?: boolean;
  restockKind?: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION";
  restockOperationId?: string;
  now?: Date;
}): Promise<StorefrontBuyerRefundResult> {
  const { stripe, order } = args;
  const amount = args.amountCents;
  if (amount === 0) {
    return { status: "zero_amount", amountCents: 0, stripeRefund: null, alreadySucceeded: false };
  }
  if (amount < 0) {
    return {
      status: "conflict",
      error: "Refund amount is invalid; operator reconciliation is required.",
      httpStatus: 409,
    };
  }
  if (!order.stripePaymentIntentId) {
    return { status: "failed", error: "Order has no payment to refund", httpStatus: 400 };
  }

  const cutover = await getCommerceFoundationCutoverState(prisma);
  const writerRoute = commerceInventoryWriterRoute(cutover.mode);
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
          amountCents: amount,
          fullAmountCents: refundAmountCents(order),
        }),
        restockRequested: args.restock !== false,
        reason: args.reason ?? null,
        now: args.now,
      });
      if (refundIntent.action === "replay_window_expired") {
        return {
          status: "replay_window_expired",
          error: "Buyer refund replay window expired; operator recovery is required.",
          httpStatus: 409,
        };
      }
      if (refundIntent.action === "operator_required") {
        return {
          status: "conflict",
          error: "Refund succeeded without a Stripe refund id; operator recovery is required.",
          httpStatus: 409,
        };
      }
      refundAction = refundIntent.action;
      refundKey = refundIntent.operation.providerIdempotencyKey;
      existingStripeRefundId = refundIntent.operation.stripeRefundId;
    } catch (e) {
      if (e instanceof FoundationRefundIntentConflictError) {
        return { status: "conflict", error: e.message, httpStatus: 409 };
      }
      throw e;
    }
  }

  let stripeRefund: StorefrontBuyerRefundStripe | null = null;
  if (refundAction === "already_succeeded" && existingStripeRefundId) {
    stripeRefund = { id: existingStripeRefundId, status: "succeeded" };
    return { status: "succeeded", amountCents: amount, stripeRefund, alreadySucceeded: true };
  }

  try {
    stripeRefund = await stripe.refunds.create(refundParams, { idempotencyKey: refundKey });
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
      if (isStripeRefundIdempotencyMismatch(e)) {
        return {
          status: "conflict",
          error: "Refund request parameters conflict with the existing refund operation",
          httpStatus: 409,
        };
      }
      return outcomeStatus === "UNCERTAIN"
        ? { status: "uncertain", error: msg, httpStatus: 500 }
        : { status: "failed", error: msg, httpStatus: 500 };
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
          return { status: "conflict", error: e.message, httpStatus: 409 };
        }
        await persistFoundationRefundOutcome(prisma, {
          storeOrderId: order.id,
          status: "UNCERTAIN",
          lastError: e instanceof Error ? e.message : "persist_refund_success_failed",
        }).catch(() => {});
        return {
          status: "uncertain",
          error: "Refund provider outcome is uncertain; retry the same refund",
          httpStatus: 500,
        };
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
    return {
      status: "uncertain",
      error: "Refund provider outcome is uncertain; retry the same refund",
      httpStatus: 500,
    };
  }

  return { status: "succeeded", amountCents: amount, stripeRefund, alreadySucceeded: false };
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
    inventoryRestoredAt?: Date | string | null;
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
  /**
   * Who absorbs Stripe’s non-refundable processing fees.
   * Default `buyer` (cancel/return by buyer). Use `seller` for seller cancel / courtesy refund.
   */
  stripeFeeBearer?: StorefrontStripeFeeBearer;
  /** Override Stripe refund amount. Defaults from {@link stripeFeeBearer}. */
  amountCents?: number;
  /** Override Connect transfer reversal. Defaults to the full original transfer. */
  transferReversalCents?: number;
  /** Override My Funds debit. Defaults from transfer (+ fees when seller bears them). */
  ledgerDebitCents?: number;
  /** When false, buyer keeps the item (courtesy refund). Default true. */
  restock?: boolean;
  restockOperationId?: string;
  restockKind?: "PHYSICAL_RECEIPT" | "UNDO_CONSUMPTION";
  now?: Date;
}): Promise<{ ok: true; refunded: true; amountCents: number } | { ok: false; error: string; status: number }> {
  const { stripe, order } = args;
  if (order.status === "refunded") {
    return { ok: false, error: "Order already refunded", status: 400 };
  }

  const feeBearer: StorefrontStripeFeeBearer = args.stripeFeeBearer ?? "buyer";
  const amount = args.amountCents ?? buyerRefundCentsForFeeBearer(order, feeBearer);
  if (amount < 0) {
    return {
      ok: false,
      error: "Refund amount is invalid; operator reconciliation is required.",
      status: 409,
    };
  }
  if (amount > 0 && !order.stripePaymentIntentId) {
    return { ok: false, error: "Order has no payment to refund", status: 400 };
  }

  const originalTransfer = sellerLedgerDebitCents(order);
  // Connect can only reverse up to the original transfer; seller-borne fees hit My Funds ledger.
  const reversalAmount = args.transferReversalCents ?? originalTransfer;
  const defaultLedgerDebit = sellerLedgerDebitCentsForFeeBearer(order, feeBearer);

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

  let ledgerDebitCents = args.ledgerDebitCents ?? defaultLedgerDebit;

  if (amount === 0) {
    await persistLocalStorefrontRefundCompletion({
      order,
      reason: args.reason,
      note: args.note,
      restock: args.restock,
      restockKind: args.restockKind,
      restockOperationId: args.restockOperationId,
      ledgerDebitCents: args.ledgerDebitCents ?? 0,
      skipSellerLedgerDebit,
      stripeRefund: null,
      locallyComplete: true,
    });
    return { ok: true, refunded: true, amountCents: 0 };
  }

  if (!order.stripePaymentIntentId) {
    return { ok: false, error: "Order has no payment to refund", status: 400 };
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
  let refundOperationId: string | null = null;

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
          fullAmountCents: buyerRefundCentsForFeeBearer(order, feeBearer),
        }),
        restockRequested: args.restock !== false,
        reason: args.reason ?? null,
        now: args.now,
      });
      if (refundIntent.action === "replay_window_expired") {
        return {
          ok: false,
          error: "Buyer refund replay window expired; operator recovery is required.",
          status: 409,
        };
      }
      if (refundIntent.action === "operator_required") {
        return {
          ok: false,
          error: "Refund succeeded without a Stripe refund id; operator recovery is required.",
          status: 409,
        };
      }
      refundAction = refundIntent.action;
      refundKey = refundIntent.operation.providerIdempotencyKey;
      existingStripeRefundId = refundIntent.operation.stripeRefundId;
      refundOperationId = refundIntent.operation.id;
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
    if (reversalTransferId) {
      const reversal = await ensureStorefrontTransferReversal(stripe, {
        transferId: reversalTransferId,
        storeOrderId: order.id,
        amountCents: reversalAmount,
        refundOperationId,
      });
      if (reversal.status !== "reversed" && reversal.status !== "already_reversed" && reversal.status !== "skipped") {
        return reversalHttpError(reversal);
      }
      // Keep My Funds debit aligned with the amount Stripe actually reversed.
      if (args.ledgerDebitCents == null && typeof reversal.amountCents === "number") {
        const feeAddon = feeBearer === "seller" ? nonRefundableStripeFeeCents(order) : 0;
        ledgerDebitCents = reversal.amountCents + feeAddon;
      }
    }
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

  await persistLocalStorefrontRefundCompletion({
    order,
    reason: args.reason,
    note: args.note,
    restock: args.restock,
    restockKind: args.restockKind,
    restockOperationId: args.restockOperationId,
    ledgerDebitCents,
    skipSellerLedgerDebit,
    stripeRefund,
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
  stripe?: Stripe | null,
  db: typeof prisma = prisma
): Promise<boolean> {
  const order = await db.storeOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return false;
  if (order.inventoryRestoredAt) return false;
  if (!["paid", "shipped", "delivered"].includes(order.status) && order.status !== "refunded") {
    return false;
  }

  // Historical fingerprint first: NOOP / REVIEW never reverse, lock TO, or debit.
  // Inventory may still converge independently (subject to existing cutover inventory gates).
  const historicalDecision = await loadHistoricalRefundRuntimeDecision(db, order.id);
  if (mustBlockHistoricalSellerFinancialMutation(historicalDecision)) {
    const cutover = await getCommerceFoundationCutoverState(db);
    const writerRoute = commerceInventoryWriterRoute(cutover.mode);
    if (writerRoute !== "foundation") {
      await assertLegacyInteractiveMutationAllowed(db);
    }
    await runHistoricalExternalRefundRestockBranch(db, order.id, {
      restockLines: async (tx) => {
        await restockOrderLinesAfterReturn(
          tx,
          order.items,
          "UNDO_CONSUMPTION",
          `external-refund:${order.id}`
        );
      },
    });
    return true;
  }

  const cutover = await getCommerceFoundationCutoverState(db);
  if (commerceInventoryWriterRoute(cutover.mode) !== "legacy") {
    if (commerceInventoryWriterRoute(cutover.mode) === "foundation") {
      try {
        const guard = await lockFoundationPayoutOutForRefund(db, { storeOrderId: order.id });
        if (guard.kind === "HISTORICALLY_SETTLED") {
          // Defensive: should have been handled above.
        } else if (guard.kind === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED") {
          return false;
        } else if (guard.kind === "TRANSFER_SUCCEEDED" && stripe) {
          const reversal = await ensureStorefrontTransferReversal(stripe, {
            transferId: guard.stripeTransferId,
            storeOrderId: order.id,
            amountCents: sellerLedgerDebitCents(order),
          });
          if (
            reversal.status !== "reversed" &&
            reversal.status !== "already_reversed" &&
            reversal.status !== "skipped"
          ) {
            throw new Error(reversal.error ?? "Could not reverse seller transfer");
          }
        }
      } catch (e) {
        if (e instanceof FoundationTransferRefundBlockedError) {
          return false;
        }
        throw e;
      }
    } else {
      await assertLegacyInteractiveMutationAllowed(db);
    }
  } else {
    await assertLegacyInteractiveMutationAllowed(db);
  }

  if (
    commerceInventoryWriterRoute(cutover.mode) !== "foundation" &&
    stripe &&
    order.stripeSellerTransferId
  ) {
    const reversal = await ensureStorefrontTransferReversal(stripe, {
      transferId: order.stripeSellerTransferId,
      storeOrderId: order.id,
      amountCents: sellerLedgerDebitCents(order),
    });
    if (
      reversal.status !== "reversed" &&
      reversal.status !== "already_reversed" &&
      reversal.status !== "skipped"
    ) {
      throw new Error(reversal.error ?? "Could not reverse seller transfer");
    }
  }

  await db.$transaction(async (tx) => {
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
