import type {
  FinancialOperationStatus,
  Prisma,
  PrismaClient,
  RefundKind,
  RefundOperation,
  TransferOperation,
} from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import {
  FoundationInventoryError,
  FoundationMissingStateError,
  FoundationReservationError,
} from "./commerce-foundation-inventory";
import {
  classifyHistoricalRefundCompatibility,
  resolveHistoricalRefundRuntimeDecision,
  loadHistoricalRefundCompatibilityEvidence,
} from "./foundation/historical-refund-compatibility";

export const FOUNDATION_TRANSFER_IDEMPOTENCY_PREFIX = "nwc_store_transfer_";
export const FOUNDATION_STOREFRONT_REFUND_IDEMPOTENCY_PREFIX = "nwc_store_refund_";
export const FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const FOUNDATION_TRANSFER_PROCESSING_STALE_MS = 60_000;
export const COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER = "commerce_unfulfillable_before_transfer";
export const ORDER_REFUNDED_BEFORE_TRANSFER = "order_refunded_before_transfer";
export const OPERATOR_RESET_FOR_RETRY = "operator_reset_for_retry";
export const FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID = "succeeded_without_stripe_transfer_id";
export const FOUNDATION_COMPATIBILITY_TRANSFER_ID_CONFLICT = "compatibility_transfer_id_conflict";
export const FOUNDATION_SELLER_PAYOUT_ELIGIBLE_ORDER_STATUSES = ["paid", "shipped", "delivered"] as const;
export const FOUNDATION_PAYOUT_AUTO_RETRY_OPERATION_STATUSES = ["PENDING", "PROCESSING", "UNCERTAIN"] as const;
export const FOUNDATION_PAYOUT_UNRESOLVED_OPERATION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "UNCERTAIN",
  "FAILED",
] as const;

/**
 * Foundation lock order (never invert; no ABBA with CheckoutAttempt / InventoryState):
 * A. TransferOperation intent create — unique(storeOrderId); no CONVERT locks
 * B. Foundation CONVERT — cutover SHARE → CheckoutAttempt → StoreItem → Reservation → InventoryState
 * C. markFoundationStoreOrderPaidAfterConvert — StoreOrder FOR UPDATE (sale paid; no TransferOperation write)
 * D. beginFoundationTransferAttempt — StoreOrder FOR UPDATE → TransferOperation FOR UPDATE; provider call OUTSIDE TX
 * E. persistFoundationTransferSuccess / persistFoundationTransferOutcome — StoreOrder FOR UPDATE → TransferOperation FOR UPDATE
 * F. completeFoundationSellerPayoutLedger — StoreOrder FOR UPDATE, then TransferOperation read (ledger after SUCCEEDED only)
 * G. lockFoundationPayoutOutForRefund — StoreOrder FOR UPDATE → TransferOperation FOR UPDATE; Stripe refund OUTSIDE TX
 * H. resetFoundationTransferForOperatorRetry — StoreOrder FOR UPDATE → TransferOperation FOR UPDATE; NO Stripe call
 * I. ensureFoundationStorefrontRefundOperation — StoreOrder FOR UPDATE → RefundOperation; provider call OUTSIDE TX
 *    Never lock TransferOperation in this writer path (do not invert G/H).
 */

/**
 * FAILED is overloaded. Readers must use status + lastError/failure classification + commerceStatus.
 * Do not assume every FAILED TransferOperation is equivalent or retryable.
 */

export function foundationTransferIdempotencyKey(storeOrderId: string): string {
  return `${FOUNDATION_TRANSFER_IDEMPOTENCY_PREFIX}${storeOrderId}`;
}

/**
 * One causal platform refund per StoreOrder for `refundPaidStorefrontOrder`.
 * Cancel / seller-cancel / courtesy / return-receive are mutually exclusive at success
 * (StoreOrder becomes refunded). Distinct amount/currency on retry is a local intent conflict.
 */
export function foundationStorefrontRefundIdempotencyKey(storeOrderId: string): string {
  return `${FOUNDATION_STOREFRONT_REFUND_IDEMPOTENCY_PREFIX}${storeOrderId}`;
}

export function isFoundationSellerPayoutEligibleOrderStatus(status: string): boolean {
  return (
    status === "paid" ||
    status === "shipped" ||
    status === "delivered"
  );
}

/** Buyer payment completed for payout recovery: paid, shipped, or delivered. Pending is crash-repair only. */
export function isFoundationBuyerSaleCompleteStatus(status: string): boolean {
  return isFoundationSellerPayoutEligibleOrderStatus(status);
}

/**
 * Provider payout already succeeded; remaining work is local projection/ledger repair only.
 * Never implies a Stripe transfer create.
 */
export function isFoundationSucceededPayoutLocalRepairEligible(args: {
  commerceStatus: string;
  orderStatus: string;
  transferStatus: string;
  stripeTransferId: string | null | undefined;
}): boolean {
  return (
    args.commerceStatus === "FINALIZED" &&
    isFoundationSellerPayoutEligibleOrderStatus(args.orderStatus) &&
    args.transferStatus === "SUCCEEDED" &&
    Boolean(args.stripeTransferId)
  );
}

export function foundationSucceededPayoutWhere(): Prisma.StoreOrderWhereInput {
  return {
    commerceStatus: "FINALIZED",
    status: { in: [...FOUNDATION_SELLER_PAYOUT_ELIGIBLE_ORDER_STATUSES] },
    transferOperation: { status: "SUCCEEDED", stripeTransferId: { not: null } },
  };
}

/**
 * Foundation fulfill/payout selector (session/order-id scoped by callers):
 * A. pending (initial CONVERT + pending+FINALIZED crash-repair)
 * B. paid/shipped/delivered FINALIZED with incomplete auto-retry TransferOperation
 * C. SUCCEEDED + Stripe transfer id — local projection/ledger repair only (no provider create)
 * Does not select refunded/canceled. FAILED payouts are not auto-retried.
 */
export function foundationSellerPayoutRecoveryWhere(): Prisma.StoreOrderWhereInput {
  const eligible = [...FOUNDATION_SELLER_PAYOUT_ELIGIBLE_ORDER_STATUSES];
  return {
    OR: [
      { status: "pending" },
      {
        commerceStatus: "FINALIZED",
        status: { in: eligible },
        transferOperation: { status: { in: [...FOUNDATION_PAYOUT_AUTO_RETRY_OPERATION_STATUSES] } },
      },
      foundationSucceededPayoutWhere(),
    ],
  };
}

function compatibilityTransferIdConflicts(
  orderId: string | null | undefined,
  operationId: string | null | undefined
): boolean {
  return Boolean(orderId && operationId && orderId !== operationId);
}

export class FoundationTransferIntentConflictError extends FoundationInventoryError {
  constructor(message: string) {
    super("transfer_intent_conflict", message);
    this.name = "FoundationTransferIntentConflictError";
  }
}

export class FoundationTransferOperatorRequiredError extends FoundationInventoryError {
  constructor(message: string) {
    super("transfer_operator_required", message);
    this.name = "FoundationTransferOperatorRequiredError";
  }
}

export type FoundationPayoutRefundDisposition =
  | "TRANSFER_SUCCEEDED"
  | "NO_TRANSFER_ATTEMPTED"
  | "DEFINITIVE_NO_TRANSFER"
  | "PAYOUT_ALREADY_LOCKED_OUT"
  | "TRANSFER_IN_FLIGHT"
  | "TRANSFER_UNCERTAIN"
  | "TRANSFER_ID_MISSING"
  | "UNFULFILLABLE"
  | "NOT_FOUNDATION_TRANSFER";

export type FoundationFailedTransferRetryability = "RETRYABLE_BY_OPERATOR" | "TERMINAL_LOCAL";

export type FoundationTransferResetErrorCode =
  | "not_found"
  | "not_failed"
  | "terminal_local"
  | "transfer_already_exists"
  | "payout_unresolved"
  | "order_not_finalized_active_sale";

export class FoundationTransferResetError extends FoundationInventoryError {
  constructor(
    public readonly resetCode: FoundationTransferResetErrorCode,
    message: string
  ) {
    super("transfer_operator_reset_rejected", message);
    this.name = "FoundationTransferResetError";
  }
}

export class FoundationRefundIntentConflictError extends FoundationInventoryError {
  constructor(message: string) {
    super("refund_intent_conflict", message);
    this.name = "FoundationRefundIntentConflictError";
  }
}

export class FoundationTransferRefundBlockedError extends FoundationInventoryError {
  constructor(
    public readonly disposition: FoundationPayoutRefundDisposition,
    message: string
  ) {
    super("transfer_refund_blocked", message);
    this.name = "FoundationTransferRefundBlockedError";
  }
}

export type FoundationTransferIntentInput = {
  storeOrderId: string;
  memberId: string;
  amountCents: number;
  currency?: string;
};

export type FoundationTransferBeginAction =
  | { action: "provider_create"; operation: TransferOperation }
  | { action: "already_succeeded"; operation: TransferOperation }
  | { action: "skip_failed"; operation: TransferOperation }
  | { action: "skip_in_flight"; operation: TransferOperation }
  | { action: "operator_required"; operation: TransferOperation; reason: string }
  | { action: "skip_ineligible" };

type TransferClient = {
  transferOperation: PrismaClient["transferOperation"];
  refundOperation: PrismaClient["refundOperation"];
  storeOrder: PrismaClient["storeOrder"];
  sellerBalance: PrismaClient["sellerBalance"];
  sellerBalanceTransaction: PrismaClient["sellerBalanceTransaction"];
  sellerReturnEntitlementOperation: PrismaClient["sellerReturnEntitlementOperation"];
  checkoutAttempt: PrismaClient["checkoutAttempt"];
  $transaction: PrismaClient["$transaction"];
  $executeRaw: PrismaClient["$executeRaw"];
};

function isPrismaKnown(err: unknown): err is PrismaNS.PrismaClientKnownRequestError {
  return err instanceof PrismaNS.PrismaClientKnownRequestError;
}

export function isRetryableFoundationCommerceError(err: unknown): boolean {
  if (isPermanentFoundationNonconvertibleError(err)) return false;
  if (isPrismaKnown(err) && (err.code === "P2034" || err.code === "P2024" || err.code === "P2028")) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /timeout|ECONNRESET|ETIMEDOUT|serialization|deadlock|could not serialize/i.test(msg);
}

export function isPermanentFoundationNonconvertibleError(err: unknown): boolean {
  if (err instanceof FoundationMissingStateError) return true;
  if (err instanceof FoundationReservationError && err.code === "reservation_not_convertible") return true;
  if (err instanceof FoundationInventoryError && err.code === "convert_underflow") return true;
  return err instanceof Error && err.name === "FoundationCheckoutNotConvertibleError";
}

const IDEMPOTENCY_MISMATCH_RE =
  /keys for idempotent requests|idempotent requests can only be used with the same parameters|idempotency(?: key)?(?: parameter)? mismatch|idempotency_key_in_use/i;

const STRONG_NO_CREATE_CODES = new Set([
  "balance_insufficient",
  "account_invalid",
  "account_closed",
  "transfers_not_allowed",
  "resource_missing",
]);

/**
 * Provider-call classifier. FAILED only when there is strong evidence Stripe did not create a Transfer.
 * Generic 4xx is UNCERTAIN. Idempotency-key parameter mismatch is UNCERTAIN (an earlier transfer may exist).
 */
export function classifyStripeTransferFailure(err: unknown): "failed" | "uncertain" {
  const e = err as { type?: string; statusCode?: number; code?: string; message?: string; rawType?: string };
  const msg = `${typeof e?.message === "string" ? e.message : String(err ?? "")} ${e?.code ?? ""}`;
  if (e?.type === "StripeIdempotencyError" || IDEMPOTENCY_MISMATCH_RE.test(msg)) return "uncertain";
  if (e?.type === "StripeConnectionError") return "uncertain";
  if (e?.type === "StripeRateLimitError") return "uncertain";
  if (e?.type === "StripeAuthenticationError") return "uncertain";
  if (e?.type === "StripeAPIError") return "uncertain";
  const status = e?.statusCode;
  if (status === 0 || (status == null && /timeout|ECONNRESET|ETIMEDOUT|network|socket/i.test(msg))) {
    return "uncertain";
  }
  if (typeof status === "number" && status >= 500) return "uncertain";
  if (status === 429) return "uncertain";
  if (/timeout|ECONNRESET|ETIMEDOUT|network|socket/i.test(msg) && e?.type !== "StripeInvalidRequestError") {
    return "uncertain";
  }
  if (STRONG_NO_CREATE_CODES.has(e?.code ?? "")) return "failed";
  if (
    /no such (destination|charge|customer|account)\b/i.test(msg) ||
    /insufficient available (funds|balance)/i.test(msg)
  ) {
    return "failed";
  }
  if (e?.type === "StripeInvalidRequestError") {
    return "uncertain";
  }
  if (typeof status === "number" && status >= 400 && status < 500) return "uncertain";
  return "uncertain";
}

const RETRYABLE_LOCAL_FAILED_RE =
  /missing_connect_account|missing_charge|no such destination|account_invalid|account_closed|transfers_not_allowed|balance_insufficient|insufficient available/i;

/**
 * Service-layer FAILED discriminator (not a Prisma enum).
 * TERMINAL_LOCAL: never operator-reset (unfulfillable / buyer already refunded).
 * RETRYABLE_BY_OPERATOR: correctable no-create (missing Connect, etc.).
 */
export function classifyFoundationFailedTransferRetryability(
  lastError: string | null | undefined
): FoundationFailedTransferRetryability {
  const err = (lastError ?? "").trim();
  if (err === COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER) return "TERMINAL_LOCAL";
  if (err === ORDER_REFUNDED_BEFORE_TRANSFER) return "TERMINAL_LOCAL";
  if (err === OPERATOR_RESET_FOR_RETRY) return "RETRYABLE_BY_OPERATOR";
  if (RETRYABLE_LOCAL_FAILED_RE.test(err)) return "RETRYABLE_BY_OPERATOR";
  return "TERMINAL_LOCAL";
}

/**
 * Absolute same-key replay horizon for TransferOperation, SellerReturnEntitlementOperation,
 * and Foundation RefundOperation. `lastAttemptAt` is observability / PROCESSING-staleness only.
 * retryCount == 0: first provider attempt is allowed regardless of createdAt.
 * retryCount >= 1: automatic replay only if createdAt is within 23h of now.
 */
export function isFoundationSameKeyReplayAllowed(args: {
  retryCount: number;
  createdAt: Date;
  now?: Date;
}): boolean {
  if (args.retryCount <= 0) return true;
  const now = args.now ?? new Date();
  return now.getTime() - args.createdAt.getTime() <= FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS;
}

export function evaluateFoundationPayoutRefundDisposition(args: {
  commerceStatus: string;
  transferOperation: {
    status: string;
    retryCount: number;
    stripeTransferId: string | null;
    lastError: string | null;
  } | null;
}): FoundationPayoutRefundDisposition {
  if (args.commerceStatus === "UNFULFILLABLE") return "UNFULFILLABLE";
  const op = args.transferOperation;
  if (!op) return "NO_TRANSFER_ATTEMPTED";
  if (op.status === "SUCCEEDED") {
    return op.stripeTransferId ? "TRANSFER_SUCCEEDED" : "TRANSFER_ID_MISSING";
  }
  if (op.status === "PROCESSING") return "TRANSFER_IN_FLIGHT";
  if (op.status === "UNCERTAIN") return "TRANSFER_UNCERTAIN";
  if (op.status === "PENDING") {
    if (op.retryCount === 0 && !op.stripeTransferId) return "NO_TRANSFER_ATTEMPTED";
    return "TRANSFER_UNCERTAIN";
  }
  if (op.status === "FAILED") {
    if (op.stripeTransferId) return "TRANSFER_ID_MISSING";
    const err = op.lastError ?? "";
    if (err === COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER) return "UNFULFILLABLE";
    if (err === ORDER_REFUNDED_BEFORE_TRANSFER && !op.stripeTransferId) {
      return "PAYOUT_ALREADY_LOCKED_OUT";
    }
    if (op.retryCount === 0) return "DEFINITIVE_NO_TRANSFER";
    if (classifyFoundationFailedTransferRetryability(err) === "RETRYABLE_BY_OPERATOR") {
      return "DEFINITIVE_NO_TRANSFER";
    }
    return "TRANSFER_UNCERTAIN";
  }
  return "TRANSFER_UNCERTAIN";
}

type SucceededPayoutLocalRepairClient = {
  transferOperation: PrismaClient["transferOperation"];
  sellerBalanceTransaction: PrismaClient["sellerBalanceTransaction"];
};

/**
 * True when a FINALIZED paid/shipped/delivered sale has a succeeded Stripe transfer
 * but local compatibility ID and/or sale ledger still need repair (or conflict).
 */
export async function foundationSucceededPayoutLocalRepairOutstanding(
  db: SucceededPayoutLocalRepairClient,
  attemptId: string
): Promise<boolean> {
  const ops = await db.transferOperation.findMany({
    where: {
      storeOrder: { checkoutAttemptId: attemptId },
      status: "SUCCEEDED",
      stripeTransferId: { not: null },
    },
    select: {
      stripeTransferId: true,
      storeOrder: {
        select: {
          id: true,
          status: true,
          commerceStatus: true,
          stripeSellerTransferId: true,
        },
      },
    },
  });
  for (const op of ops) {
    const order = op.storeOrder;
    if (
      !isFoundationSucceededPayoutLocalRepairEligible({
        commerceStatus: order.commerceStatus,
        orderStatus: order.status,
        transferStatus: "SUCCEEDED",
        stripeTransferId: op.stripeTransferId,
      })
    ) {
      continue;
    }
    if (compatibilityTransferIdConflicts(order.stripeSellerTransferId, op.stripeTransferId)) return true;
    if (!order.stripeSellerTransferId) return true;
    const sale = await db.sellerBalanceTransaction.findFirst({
      where: { orderId: order.id, type: "sale" },
      select: { id: true },
    });
    if (!sale) return true;
  }
  return false;
}

/** Bounded attempt ids whose SUCCEEDED payout still needs local repair. Not a historical SUCCEEDED scan. */
export async function listFoundationSucceededPayoutLocalRepairAttemptIds(
  prisma: Pick<PrismaClient, "$queryRaw">,
  take = 20
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string | null }>>(PrismaNS.sql`
    SELECT DISTINCT so."checkout_attempt_id" AS id
    FROM "StoreOrder" so
    INNER JOIN "transfer_operation" t ON t."store_order_id" = so."id"
    WHERE so."checkout_attempt_id" IS NOT NULL
      AND so."commerce_status" = 'FINALIZED'::commerce_status
      AND so."status" IN ('paid', 'shipped', 'delivered')
      AND t."status" = 'SUCCEEDED'::financial_operation_status
      AND t."stripe_transfer_id" IS NOT NULL
      AND (
        so."stripe_seller_transfer_id" IS NULL
        OR so."stripe_seller_transfer_id" <> t."stripe_transfer_id"
        OR NOT EXISTS (
          SELECT 1 FROM "SellerBalanceTransaction" sbt
          WHERE sbt."order_id" = so."id" AND sbt."type" = 'sale'
        )
      )
    LIMIT ${take}
  `);
  return rows.map((row) => row.id).filter((id): id is string => Boolean(id));
}

async function lockTransferOperationForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "transfer_operation" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockStoreOrderForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockRefundOperationForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "refund_operation" WHERE "id" = ${id} FOR UPDATE`;
}

function intentMatches(
  row: TransferOperation,
  input: Required<Pick<FoundationTransferIntentInput, "storeOrderId" | "memberId" | "amountCents">> & {
    currency: string;
    providerIdempotencyKey: string;
  }
): boolean {
  return (
    row.storeOrderId === input.storeOrderId &&
    row.memberId === input.memberId &&
    row.amountCents === input.amountCents &&
    row.currency === input.currency &&
    row.providerIdempotencyKey === input.providerIdempotencyKey
  );
}

export async function ensureFoundationTransferIntent(
  prisma: TransferClient,
  input: FoundationTransferIntentInput
): Promise<TransferOperation> {
  const currency = (input.currency ?? "usd").trim() || "usd";
  const key = foundationTransferIdempotencyKey(input.storeOrderId);
  const expected = {
    storeOrderId: input.storeOrderId,
    memberId: input.memberId,
    amountCents: input.amountCents,
    currency,
    providerIdempotencyKey: key,
  };
  const existing = await prisma.transferOperation.findUnique({
    where: { storeOrderId: input.storeOrderId },
  });
  if (existing) {
    if (!intentMatches(existing, expected)) {
      throw new FoundationTransferIntentConflictError(
        `TransferOperation intent conflict for StoreOrder ${input.storeOrderId}`
      );
    }
    return existing;
  }
  try {
    return await prisma.transferOperation.create({
      data: {
        storeOrderId: input.storeOrderId,
        memberId: input.memberId,
        amountCents: input.amountCents,
        currency,
        providerIdempotencyKey: key,
        status: "PENDING",
      },
    });
  } catch (err) {
    if (!isPrismaKnown(err) || err.code !== "P2002") throw err;
    const raced = await prisma.transferOperation.findUnique({
      where: { storeOrderId: input.storeOrderId },
    });
    if (!raced || !intentMatches(raced, expected)) {
      throw new FoundationTransferIntentConflictError(
        `TransferOperation intent conflict for StoreOrder ${input.storeOrderId}`
      );
    }
    return raced;
  }
}

export async function ensureFoundationTransferIntents(
  prisma: TransferClient,
  inputs: FoundationTransferIntentInput[]
): Promise<TransferOperation[]> {
  const rows: TransferOperation[] = [];
  for (const input of inputs) {
    rows.push(await ensureFoundationTransferIntent(prisma, input));
  }
  return rows;
}

type UnfulfillableClient = {
  storeOrder: TransferClient["storeOrder"];
  transferOperation: TransferClient["transferOperation"];
};

export async function markFoundationAttemptUnfulfillableInTx(
  tx: UnfulfillableClient,
  attemptId: string
): Promise<void> {
  const orders = await tx.storeOrder.findMany({
    where: { checkoutAttemptId: attemptId },
    select: { id: true, commerceStatus: true },
  });
  const eligibleIds = orders.filter((row) => row.commerceStatus !== "FINALIZED").map((row) => row.id);
  if (eligibleIds.length === 0) return;
  await tx.storeOrder.updateMany({
    where: { id: { in: eligibleIds } },
    data: { commerceStatus: "UNFULFILLABLE" },
  });
  await tx.transferOperation.updateMany({
    where: {
      storeOrderId: { in: eligibleIds },
      stripeTransferId: null,
      status: { in: ["PENDING", "PROCESSING", "FAILED", "UNCERTAIN"] },
    },
    data: {
      status: "FAILED",
      lastError: COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER,
      retryCount: 0,
    },
  });
}

export async function markFoundationAttemptUnfulfillable(
  prisma: TransferClient,
  attemptId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await markFoundationAttemptUnfulfillableInTx(tx, attemptId);
  });
}

function saleLifecycleAllowsFoundationPayout(status: string): boolean {
  return isFoundationSellerPayoutEligibleOrderStatus(status) || status === "pending";
}

export async function beginFoundationTransferAttempt(
  prisma: TransferClient,
  args: { storeOrderId: string; now?: Date }
): Promise<FoundationTransferBeginAction> {
  const now = args.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: args.storeOrderId } });
    if (!order) return { action: "skip_ineligible" as const };
    if (order.commerceStatus !== "FINALIZED") return { action: "skip_ineligible" as const };
    if (!saleLifecycleAllowsFoundationPayout(order.status)) {
      return { action: "skip_ineligible" as const };
    }

    const current = await tx.transferOperation.findUnique({ where: { storeOrderId: args.storeOrderId } });
    if (!current) {
      throw new FoundationTransferOperatorRequiredError(
        `TransferOperation missing for finalized StoreOrder ${args.storeOrderId}`
      );
    }
    await lockTransferOperationForUpdate(tx, current.id);
    const operation = (await tx.transferOperation.findUnique({ where: { id: current.id } })) ?? current;

    if (operation.status === "SUCCEEDED") {
      if (!operation.stripeTransferId) {
        return {
          action: "operator_required" as const,
          operation,
          reason: FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
        };
      }
      if (compatibilityTransferIdConflicts(order.stripeSellerTransferId, operation.stripeTransferId)) {
        return {
          action: "operator_required" as const,
          operation,
          reason: FOUNDATION_COMPATIBILITY_TRANSFER_ID_CONFLICT,
        };
      }
      return { action: "already_succeeded" as const, operation };
    }

    if (operation.status === "FAILED") {
      return { action: "skip_failed" as const, operation };
    }

    if (operation.status === "PROCESSING") {
      const age = operation.lastAttemptAt ? now.getTime() - operation.lastAttemptAt.getTime() : Number.POSITIVE_INFINITY;
      if (age < FOUNDATION_TRANSFER_PROCESSING_STALE_MS) {
        return { action: "skip_in_flight" as const, operation };
      }
    }

    const treatUncertain =
      operation.status === "UNCERTAIN" ||
      (operation.status === "PROCESSING" &&
        (!operation.lastAttemptAt ||
          now.getTime() - operation.lastAttemptAt.getTime() >= FOUNDATION_TRANSFER_PROCESSING_STALE_MS));

    const providerMayHaveBeenCalled =
      operation.retryCount >= 1 || operation.status === "UNCERTAIN" || treatUncertain;

    if (
      providerMayHaveBeenCalled &&
      operation.stripeTransferId == null &&
      !isFoundationSameKeyReplayAllowed({
        retryCount: Math.max(operation.retryCount, 1),
        createdAt: operation.createdAt,
        now,
      })
    ) {
      if (operation.status === "PROCESSING") {
        const aged = await tx.transferOperation.update({
          where: { id: operation.id },
          data: { status: "UNCERTAIN", lastError: operation.lastError ?? "provider_outcome_uncertain" },
        });
        return { action: "operator_required" as const, operation: aged, reason: "uncertain_replay_window_elapsed" };
      }
      return { action: "operator_required" as const, operation, reason: "uncertain_replay_window_elapsed" };
    }

    const next = await tx.transferOperation.update({
      where: { id: operation.id },
      data: {
        status: "PROCESSING",
        retryCount: { increment: 1 },
        lastAttemptAt: now,
        lastError: null,
      },
    });
    return { action: "provider_create" as const, operation: next };
  });
}

export async function persistFoundationTransferSuccess(
  prisma: TransferClient,
  args: { storeOrderId: string; stripeTransferId: string }
): Promise<TransferOperation> {
  const stripeTransferId = args.stripeTransferId.trim();
  if (!stripeTransferId) {
    throw new FoundationTransferOperatorRequiredError(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
  }
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: args.storeOrderId } });
    const current = await tx.transferOperation.findUnique({ where: { storeOrderId: args.storeOrderId } });
    if (!current) {
      throw new FoundationTransferOperatorRequiredError(
        `TransferOperation missing for StoreOrder ${args.storeOrderId}`
      );
    }
    await lockTransferOperationForUpdate(tx, current.id);
    const locked = (await tx.transferOperation.findUnique({ where: { id: current.id } })) ?? current;
    if (locked.status === "SUCCEEDED") {
      if (locked.stripeTransferId && locked.stripeTransferId !== stripeTransferId) {
        throw new FoundationTransferIntentConflictError(
          `TransferOperation already succeeded with a different Stripe transfer for ${args.storeOrderId}`
        );
      }
      if (!locked.stripeTransferId) {
        throw new FoundationTransferOperatorRequiredError(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
      }
      if (order && compatibilityTransferIdConflicts(order.stripeSellerTransferId, locked.stripeTransferId)) {
        throw new FoundationTransferIntentConflictError(
          `StoreOrder ${args.storeOrderId} already has a different compatibility transfer ID`
        );
      }
      if (order && !order.stripeSellerTransferId) {
        await tx.storeOrder.update({
          where: { id: order.id },
          data: { stripeSellerTransferId: locked.stripeTransferId },
        });
      }
      return locked;
    }
    if (order?.stripeSellerTransferId && order.stripeSellerTransferId !== stripeTransferId) {
      throw new FoundationTransferIntentConflictError(
        `StoreOrder ${args.storeOrderId} already has a different compatibility transfer ID`
      );
    }
    const updated = await tx.transferOperation.update({
      where: { id: locked.id },
      data: {
        stripeTransferId,
        status: "SUCCEEDED",
        succeededAt: new Date(),
        lastError: null,
      },
    });
    if (order && order.stripeSellerTransferId !== stripeTransferId) {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: { stripeSellerTransferId: stripeTransferId },
      });
    }
    return updated;
  });
}

export async function persistFoundationTransferOutcome(
  prisma: TransferClient,
  args: { storeOrderId: string; status: "FAILED" | "UNCERTAIN"; lastError: string }
): Promise<TransferOperation> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.transferOperation.findUnique({ where: { storeOrderId: args.storeOrderId } });
    if (!current) {
      throw new FoundationTransferOperatorRequiredError(
        `TransferOperation missing for StoreOrder ${args.storeOrderId}`
      );
    }
    await lockTransferOperationForUpdate(tx, current.id);
    const locked = (await tx.transferOperation.findUnique({ where: { id: current.id } })) ?? current;
    if (locked.status === "SUCCEEDED" && locked.stripeTransferId) return locked;
    return tx.transferOperation.update({
      where: { id: locked.id },
      data: {
        status: args.status,
        lastError: args.lastError.slice(0, 2000),
        lastAttemptAt: locked.lastAttemptAt ?? new Date(),
      },
    });
  });
}

export type CompleteFoundationPaidOrderInput = {
  storeOrderId: string;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  taxCents?: number;
  salesTaxReserveCents?: number;
  platformFeeCents?: number;
  shippingAddress?: object | null;
  sellerCreditsCents: number;
};

export type MarkFoundationStoreOrderPaidInput = Omit<CompleteFoundationPaidOrderInput, "sellerCreditsCents">;

/**
 * Buyer-sale completion: commerce FINALIZED → StoreOrder.status = paid.
 * Independent of TransferOperation. Seller ledger is NOT written here.
 */
export async function markFoundationStoreOrderPaidAfterConvert(
  prisma: TransferClient,
  input: MarkFoundationStoreOrderPaidInput
): Promise<{ paid: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, input.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId } });
    if (!order) return { paid: false };
    if (order.commerceStatus !== "FINALIZED") return { paid: false };
    if (order.status === "refunded" || order.status === "canceled") return { paid: false };

    const sessionPatch = {
      stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? order.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? order.stripePaymentIntentId,
      taxCents: input.taxCents ?? order.taxCents,
      salesTaxReserveCents: input.salesTaxReserveCents ?? order.salesTaxReserveCents,
      platformFeeCents: input.platformFeeCents ?? order.platformFeeCents,
      ...(input.shippingAddress ? { shippingAddress: input.shippingAddress as Prisma.InputJsonValue } : {}),
    };

    if (order.status === "pending") {
      const updated = await tx.storeOrder.updateMany({
        where: { id: order.id, status: "pending", commerceStatus: "FINALIZED" },
        data: { status: "paid", ...sessionPatch },
      });
      return { paid: updated.count > 0 || true };
    }

    await tx.storeOrder.update({
      where: { id: order.id },
      data: sessionPatch,
    });
    return { paid: true };
  });
}

/**
 * Seller payout accounting after TransferOperation SUCCEEDED.
 * SellerBalance / type `sale` represents completed Connect payout, not buyer-sale accrual.
 */
export async function completeFoundationSellerPayoutLedger(
  prisma: TransferClient,
  input: { storeOrderId: string; sellerCreditsCents: number }
): Promise<{ ledgerCreated: boolean }> {
  if (input.sellerCreditsCents <= 0) return { ledgerCreated: false };
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, input.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId } });
    if (!order) return { ledgerCreated: false };
    if (order.status === "refunded" || order.status === "canceled" || order.commerceStatus === "UNFULFILLABLE") {
      return { ledgerCreated: false };
    }
    const operation = await tx.transferOperation.findUnique({ where: { storeOrderId: input.storeOrderId } });
    if (!operation || operation.status !== "SUCCEEDED" || !operation.stripeTransferId) {
      throw new FoundationTransferOperatorRequiredError(
        `Cannot credit seller ledger for StoreOrder ${input.storeOrderId} without a succeeded TransferOperation`
      );
    }
    if (!isFoundationSellerPayoutEligibleOrderStatus(order.status)) {
      return { ledgerCreated: false };
    }
    const stripeSellerTransferId = operation.stripeTransferId;
    if (compatibilityTransferIdConflicts(order.stripeSellerTransferId, stripeSellerTransferId)) {
      throw new FoundationTransferIntentConflictError(
        `StoreOrder ${input.storeOrderId} already has a different compatibility transfer ID`
      );
    }
    if (!order.stripeSellerTransferId) {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: { stripeSellerTransferId },
      });
    }
    const existingSale = await tx.sellerBalanceTransaction.findFirst({
      where: { orderId: order.id, type: "sale" },
      select: { id: true },
    });
    if (existingSale) return { ledgerCreated: false };
    await tx.sellerBalance.upsert({
      where: { memberId: order.sellerId },
      create: {
        memberId: order.sellerId,
        balanceCents: input.sellerCreditsCents,
        totalEarnedCents: input.sellerCreditsCents,
      },
      update: {
        balanceCents: { increment: input.sellerCreditsCents },
        totalEarnedCents: { increment: input.sellerCreditsCents },
      },
    });
    await tx.sellerBalanceTransaction.create({
      data: {
        memberId: order.sellerId,
        type: "sale",
        amountCents: input.sellerCreditsCents,
        orderId: order.id,
        description: `Sale: Order #${order.id.slice(-6)}`,
        stripeTransferId: stripeSellerTransferId,
      },
    });
    return { ledgerCreated: true };
  });
}

/** Compatibility wrapper: mark sale paid, then credit ledger only if TransferOperation SUCCEEDED. */
export async function completeFoundationStoreOrderPaid(
  prisma: TransferClient,
  input: CompleteFoundationPaidOrderInput
): Promise<{ paid: boolean; ledgerCreated: boolean }> {
  const marked = await markFoundationStoreOrderPaidAfterConvert(prisma, input);
  if (!marked.paid) return { paid: false, ledgerCreated: false };
  if (input.sellerCreditsCents <= 0) return { paid: true, ledgerCreated: false };
  const ledger = await completeFoundationSellerPayoutLedger(prisma, {
    storeOrderId: input.storeOrderId,
    sellerCreditsCents: input.sellerCreditsCents,
  });
  return { paid: true, ledgerCreated: ledger.ledgerCreated };
}

export type FoundationPayoutOperationView = {
  transferOperationId: string;
  storeOrderId: string;
  memberId: string;
  status: FinancialOperationStatus;
  amountCents: number;
  currency: string;
  stripeTransferId: string | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  retryCount: number;
  orderStatus: string;
  commerceStatus: string;
};

export async function listFoundationPayoutReconciliation(
  prisma: TransferClient,
  args?: { take?: number; statuses?: FinancialOperationStatus[] }
): Promise<FoundationPayoutOperationView[]> {
  const take = args?.take ?? 50;
  const statuses = args?.statuses ?? (["PENDING", "PROCESSING", "FAILED", "UNCERTAIN"] as FinancialOperationStatus[]);
  const rows = await prisma.transferOperation.findMany({
    where: { status: { in: statuses } },
    orderBy: { updatedAt: "desc" },
    take,
    include: {
      storeOrder: { select: { status: true, commerceStatus: true } },
    },
  });
  return rows.map((row) => ({
    transferOperationId: row.id,
    storeOrderId: row.storeOrderId,
    memberId: row.memberId,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    stripeTransferId: row.stripeTransferId,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    retryCount: row.retryCount,
    orderStatus: row.storeOrder.status,
    commerceStatus: row.storeOrder.commerceStatus,
  }));
}

export type FoundationPayoutRefundLockResult =
  | { kind: "TRANSFER_SUCCEEDED"; stripeTransferId: string }
  | { kind: "LOCKED_OUT"; operation: TransferOperation | null }
  | { kind: "HISTORICALLY_SETTLED"; storeOrderId: string; reasonCodes: string[] }
  | {
      kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED";
      storeOrderId: string;
      classification: "HISTORICAL_REFUND_AMBIGUOUS" | "HISTORICAL_REFUND_ANOMALY";
      reasonCodes: string[];
    };

/**
 * Atomically prevent a never-attempted (or definitive no-transfer) payout before a buyer refund.
 * PROCESSING / UNCERTAIN / SUCCEEDED-without-ID fail closed. No Stripe call.
 */
export async function lockFoundationPayoutOutForRefund(
  prisma: TransferClient,
  args: { storeOrderId: string }
): Promise<FoundationPayoutRefundLockResult> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: args.storeOrderId } });
    if (!order) {
      throw new FoundationTransferRefundBlockedError("NOT_FOUNDATION_TRANSFER", "StoreOrder not found");
    }

    const historicalEvidence = await loadHistoricalRefundCompatibilityEvidence(
      tx as unknown as TransferClient,
      args.storeOrderId
    );
    const historical = classifyHistoricalRefundCompatibility(historicalEvidence);
    const historicalDecision = resolveHistoricalRefundRuntimeDecision(historical, historicalEvidence);
    if (historicalDecision.action === "HISTORICAL_FINANCIAL_NOOP") {
      return {
        kind: "HISTORICALLY_SETTLED" as const,
        storeOrderId: args.storeOrderId,
        reasonCodes: historicalDecision.reasonCodes,
      };
    }
    if (historicalDecision.action === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED") {
      return {
        kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED" as const,
        storeOrderId: args.storeOrderId,
        classification: historicalDecision.classification as
          | "HISTORICAL_REFUND_AMBIGUOUS"
          | "HISTORICAL_REFUND_ANOMALY",
        reasonCodes: historicalDecision.reasonCodes,
      };
    }

    const current = await tx.transferOperation.findUnique({ where: { storeOrderId: args.storeOrderId } });
    if (current) await lockTransferOperationForUpdate(tx, current.id);
    const operation = current
      ? (await tx.transferOperation.findUnique({ where: { id: current.id } })) ?? current
      : null;
    const disposition = evaluateFoundationPayoutRefundDisposition({
      commerceStatus: order.commerceStatus,
      transferOperation: operation,
    });
    if (disposition === "TRANSFER_SUCCEEDED" && operation?.stripeTransferId) {
      return { kind: "TRANSFER_SUCCEEDED" as const, stripeTransferId: operation.stripeTransferId };
    }
    if (disposition === "PAYOUT_ALREADY_LOCKED_OUT") {
      return { kind: "LOCKED_OUT" as const, operation };
    }
    if (disposition === "NO_TRANSFER_ATTEMPTED" || disposition === "DEFINITIVE_NO_TRANSFER") {
      if (operation && operation.lastError !== ORDER_REFUNDED_BEFORE_TRANSFER) {
        const lockedOut = await tx.transferOperation.update({
          where: { id: operation.id },
          data: {
            status: "FAILED",
            lastError: ORDER_REFUNDED_BEFORE_TRANSFER,
            stripeTransferId: null,
          },
        });
        return { kind: "LOCKED_OUT" as const, operation: lockedOut };
      }
      return { kind: "LOCKED_OUT" as const, operation };
    }
    throw new FoundationTransferRefundBlockedError(
      disposition,
      `Foundation paid refund blocked: ${disposition}`
    );
  });
}

export async function resetFoundationTransferForOperatorRetry(
  prisma: TransferClient,
  args: { storeOrderId: string }
): Promise<TransferOperation> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: args.storeOrderId } });
    if (!order) {
      throw new FoundationTransferResetError("not_found", `StoreOrder ${args.storeOrderId} not found`);
    }
    if (order.commerceStatus !== "FINALIZED" || !isFoundationSellerPayoutEligibleOrderStatus(order.status)) {
      throw new FoundationTransferResetError(
        "order_not_finalized_active_sale",
        `StoreOrder ${args.storeOrderId} must be a finalized active sale`
      );
    }
    const current = await tx.transferOperation.findUnique({ where: { storeOrderId: args.storeOrderId } });
    if (!current) {
      throw new FoundationTransferResetError("not_found", `TransferOperation missing for ${args.storeOrderId}`);
    }
    await lockTransferOperationForUpdate(tx, current.id);
    const operation = (await tx.transferOperation.findUnique({ where: { id: current.id } })) ?? current;
    if (operation.stripeTransferId) {
      throw new FoundationTransferResetError("transfer_already_exists", "Stripe transfer already exists");
    }
    if (operation.status === "PROCESSING" || operation.status === "UNCERTAIN") {
      throw new FoundationTransferResetError("payout_unresolved", `TransferOperation is ${operation.status}`);
    }
    if (operation.status !== "FAILED") {
      throw new FoundationTransferResetError("not_failed", `TransferOperation is ${operation.status}`);
    }
    const retryability = classifyFoundationFailedTransferRetryability(operation.lastError);
    if (retryability !== "RETRYABLE_BY_OPERATOR") {
      throw new FoundationTransferResetError(
        "terminal_local",
        operation.lastError ?? "TransferOperation failure is not operator-retryable"
      );
    }
    return tx.transferOperation.update({
      where: { id: operation.id },
      data: {
        status: "PENDING",
        lastError: OPERATOR_RESET_FOR_RETRY,
      },
    });
  });
}

export type FoundationStorefrontRefundIntentInput = {
  storeOrderId: string;
  memberId: string;
  amountCents: number;
  currency?: string;
  kind: RefundKind;
  restockRequested: boolean;
  checkoutAttemptId?: string | null;
  reason?: string | null;
  now?: Date;
};

export type FoundationStorefrontRefundBeginAction =
  | { action: "provider_create"; operation: RefundOperation }
  | { action: "already_succeeded"; operation: RefundOperation }
  | { action: "replay_window_expired"; operation: RefundOperation }
  | {
      action: "operator_required";
      operation: RefundOperation;
      reason: "succeeded_without_stripe_refund_id";
    };

function refundIntentParamsMatch(
  row: RefundOperation,
  amountCents: number,
  currency: string
): boolean {
  return row.amountCents === amountCents && row.currency === currency;
}

export async function ensureFoundationStorefrontRefundOperation(
  prisma: TransferClient,
  input: FoundationStorefrontRefundIntentInput
): Promise<FoundationStorefrontRefundBeginAction> {
  const currency = (input.currency ?? "usd").trim() || "usd";
  const key = foundationStorefrontRefundIdempotencyKey(input.storeOrderId);
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, input.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId } });
    if (!order) {
      throw new FoundationRefundIntentConflictError(`StoreOrder ${input.storeOrderId} not found`);
    }

    let row = await tx.refundOperation.findUnique({ where: { providerIdempotencyKey: key } });
    if (!row) {
      try {
        row = await tx.refundOperation.create({
          data: {
            memberId: input.memberId,
            storeOrderId: input.storeOrderId,
            checkoutAttemptId: input.checkoutAttemptId ?? order.checkoutAttemptId,
            kind: input.kind,
            amountCents: input.amountCents,
            currency,
            restockRequested: input.restockRequested,
            reason: input.reason ?? undefined,
            providerIdempotencyKey: key,
            status: "PENDING",
          },
        });
      } catch (err) {
        if (!isPrismaKnown(err) || err.code !== "P2002") throw err;
        row = await tx.refundOperation.findUnique({ where: { providerIdempotencyKey: key } });
        if (!row) {
          throw new FoundationRefundIntentConflictError(
            `RefundOperation identity conflict for StoreOrder ${input.storeOrderId}`
          );
        }
      }
    }

    await lockRefundOperationForUpdate(tx, row.id);
    const locked = (await tx.refundOperation.findUnique({ where: { id: row.id } })) ?? row;

    if (!refundIntentParamsMatch(locked, input.amountCents, currency)) {
      throw new FoundationRefundIntentConflictError(
        `RefundOperation intent conflict for StoreOrder ${input.storeOrderId}`
      );
    }

    if (locked.status === "SUCCEEDED" && locked.stripeRefundId) {
      return { action: "already_succeeded" as const, operation: locked };
    }

    if (locked.status === "SUCCEEDED" && !locked.stripeRefundId) {
      return {
        action: "operator_required" as const,
        operation: locked,
        reason: "succeeded_without_stripe_refund_id" as const,
      };
    }

    const now = input.now ?? new Date();
    if (
      !isFoundationSameKeyReplayAllowed({
        retryCount: locked.retryCount,
        createdAt: locked.createdAt,
        now,
      })
    ) {
      return { action: "replay_window_expired" as const, operation: locked };
    }

    const next = await tx.refundOperation.update({
      where: { id: locked.id },
      data: {
        status: "PROCESSING",
        retryCount: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: null,
        kind: locked.kind,
        restockRequested: input.restockRequested,
      },
    });
    return { action: "provider_create" as const, operation: next };
  });
}

export async function persistFoundationRefundSuccess(
  prisma: TransferClient,
  args: { storeOrderId: string; stripeRefundId: string }
): Promise<RefundOperation> {
  const stripeRefundId = args.stripeRefundId.trim();
  if (!stripeRefundId) {
    throw new FoundationRefundIntentConflictError(
      `Refund succeeded without Stripe refund id for StoreOrder ${args.storeOrderId}`
    );
  }
  const key = foundationStorefrontRefundIdempotencyKey(args.storeOrderId);
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.refundOperation.findUnique({ where: { providerIdempotencyKey: key } });
    if (!current) {
      throw new FoundationRefundIntentConflictError(
        `RefundOperation missing for StoreOrder ${args.storeOrderId}`
      );
    }
    await lockRefundOperationForUpdate(tx, current.id);
    const locked = (await tx.refundOperation.findUnique({ where: { id: current.id } })) ?? current;
    if (locked.status === "SUCCEEDED") {
      if (locked.stripeRefundId && locked.stripeRefundId !== stripeRefundId) {
        throw new FoundationRefundIntentConflictError(
          `RefundOperation already succeeded with a different Stripe refund for ${args.storeOrderId}`
        );
      }
      if (!locked.stripeRefundId) {
        return tx.refundOperation.update({
          where: { id: locked.id },
          data: { stripeRefundId, status: "SUCCEEDED", succeededAt: locked.succeededAt ?? new Date(), lastError: null },
        });
      }
      return locked;
    }
    return tx.refundOperation.update({
      where: { id: locked.id },
      data: {
        stripeRefundId,
        status: "SUCCEEDED",
        succeededAt: new Date(),
        lastError: null,
      },
    });
  });
}

export async function persistFoundationRefundOutcome(
  prisma: TransferClient,
  args: { storeOrderId: string; status: "FAILED" | "UNCERTAIN"; lastError: string }
): Promise<RefundOperation | null> {
  const key = foundationStorefrontRefundIdempotencyKey(args.storeOrderId);
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.refundOperation.findUnique({ where: { providerIdempotencyKey: key } });
    if (!current) return null;
    await lockRefundOperationForUpdate(tx, current.id);
    const locked = (await tx.refundOperation.findUnique({ where: { id: current.id } })) ?? current;
    if (locked.status === "SUCCEEDED" && locked.stripeRefundId) return locked;
    return tx.refundOperation.update({
      where: { id: locked.id },
      data: {
        status: args.status,
        lastError: args.lastError.slice(0, 2000),
        lastAttemptAt: locked.lastAttemptAt ?? new Date(),
      },
    });
  });
}
