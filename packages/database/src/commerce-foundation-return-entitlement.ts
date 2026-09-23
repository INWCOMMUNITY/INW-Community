import type { PrismaClient, SellerReturnEntitlementOperation, TransferOperation } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { FoundationInventoryError } from "./commerce-foundation-inventory";
import {
  classifySellerBalanceLedgerEvidence,
  isFoundationReturnLedgerAnomaly,
} from "./commerce-foundation-return-ledger-evidence";
import {
  evaluateFoundationPayoutRefundDisposition,
  FoundationTransferIntentConflictError,
  FoundationTransferOperatorRequiredError,
  FoundationTransferRefundBlockedError,
  FOUNDATION_TRANSFER_PROCESSING_STALE_MS,
  FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
  foundationStorefrontRefundIdempotencyKey,
  foundationTransferIdempotencyKey,
  isFoundationSameKeyReplayAllowed,
  OPERATOR_RESET_FOR_RETRY,
  ORDER_REFUNDED_BEFORE_TRANSFER,
  type FoundationPayoutRefundDisposition,
} from "./commerce-foundation-transfer";

export const FOUNDATION_RETURN_ENTITLEMENT_IDEMPOTENCY_PREFIX = "nwc_store_return_entitlement_";

export function foundationReturnEntitlementIdempotencyKey(storeOrderId: string): string {
  return `${FOUNDATION_RETURN_ENTITLEMENT_IDEMPOTENCY_PREFIX}${storeOrderId}`;
}

export class FoundationReturnEntitlementIntentConflictError extends FoundationInventoryError {
  constructor(message: string) {
    super("return_entitlement_intent_conflict", message);
    this.name = "FoundationReturnEntitlementIntentConflictError";
  }
}

export class FoundationReturnEntitlementCausalError extends FoundationInventoryError {
  constructor(message: string) {
    super("return_entitlement_causal_conflict", message);
    this.name = "FoundationReturnEntitlementCausalError";
  }
}

export type PrepareFoundationReturnSellerSettlementInput = {
  storeOrderId: string;
  memberId: string;
  storeReturnId: string;
  originalSaleTransferCents: number;
  entitlementAmountCents: number;
  currency?: string;
};

export type PrepareFoundationReturnSellerSettlementResult =
  | {
      kind: "ORIGINAL_TRANSFER_SUCCEEDED";
      stripeTransferId: string;
      transferOperation: TransferOperation;
    }
  | {
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT";
      transferOperation: TransferOperation;
      entitlement: SellerReturnEntitlementOperation;
    }
  | {
      kind: "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT";
      transferOperation: TransferOperation | null;
    };

type ReturnEntitlementClient = {
  storeOrder: PrismaClient["storeOrder"];
  storeReturn: PrismaClient["storeReturn"];
  transferOperation: PrismaClient["transferOperation"];
  sellerReturnEntitlementOperation: PrismaClient["sellerReturnEntitlementOperation"];
  sellerBalance: PrismaClient["sellerBalance"];
  sellerBalanceTransaction: PrismaClient["sellerBalanceTransaction"];
  $transaction: PrismaClient["$transaction"];
  $executeRaw: PrismaClient["$executeRaw"];
};

type Tx = {
  storeOrder: PrismaClient["storeOrder"];
  storeReturn: PrismaClient["storeReturn"];
  transferOperation: PrismaClient["transferOperation"];
  sellerReturnEntitlementOperation: PrismaClient["sellerReturnEntitlementOperation"];
  sellerBalance: PrismaClient["sellerBalance"];
  sellerBalanceTransaction: PrismaClient["sellerBalanceTransaction"];
  $executeRaw: PrismaClient["$executeRaw"];
};

function isPrismaKnown(err: unknown): err is PrismaNS.PrismaClientKnownRequestError {
  return err instanceof PrismaNS.PrismaClientKnownRequestError;
}

function isSafeNonnegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && Number.isSafeInteger(n);
}

function normalizeCurrency(currency: string | undefined): string {
  return (currency ?? "usd").trim() || "usd";
}

async function lockStoreOrderForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockStoreReturnForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "StoreReturn" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockTransferOperationForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "transfer_operation" WHERE "id" = ${id} FOR UPDATE`;
}

async function lockEntitlementForUpdate(tx: { $executeRaw: PrismaClient["$executeRaw"] }, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "seller_return_entitlement_operation" WHERE "id" = ${id} FOR UPDATE`;
}

function saleTransferMatches(
  row: TransferOperation,
  expected: { storeOrderId: string; memberId: string; amountCents: number; currency: string }
): boolean {
  return (
    row.storeOrderId === expected.storeOrderId &&
    row.memberId === expected.memberId &&
    row.amountCents === expected.amountCents &&
    row.currency === expected.currency &&
    row.providerIdempotencyKey === foundationTransferIdempotencyKey(expected.storeOrderId)
  );
}

function entitlementIntentMatches(
  row: SellerReturnEntitlementOperation,
  expected: {
    storeOrderId: string;
    memberId: string;
    storeReturnId: string;
    amountCents: number;
    currency: string;
  }
): boolean {
  return (
    row.storeOrderId === expected.storeOrderId &&
    row.memberId === expected.memberId &&
    row.storeReturnId === expected.storeReturnId &&
    row.amountCents === expected.amountCents &&
    row.currency === expected.currency &&
    row.providerIdempotencyKey === foundationReturnEntitlementIdempotencyKey(expected.storeOrderId)
  );
}

function throwIfBlocked(disposition: FoundationPayoutRefundDisposition, storeOrderId: string): void {
  if (
    disposition === "TRANSFER_IN_FLIGHT" ||
    disposition === "TRANSFER_UNCERTAIN" ||
    disposition === "TRANSFER_ID_MISSING" ||
    disposition === "UNFULFILLABLE" ||
    disposition === "NOT_FOUNDATION_TRANSFER"
  ) {
    throw new FoundationTransferRefundBlockedError(
      disposition,
      `Foundation return seller settlement blocked: ${disposition} for StoreOrder ${storeOrderId}`
    );
  }
}

/**
 * Atomically classify original sale-payout state and, when the full sale transfer
 * is definitively absent, terminally lock it out together with any owed
 * SellerReturnEntitlementOperation intent. No provider calls.
 *
 * Lock order (never invert): StoreOrder → StoreReturn → TransferOperation → entitlement.
 */
export async function prepareFoundationReturnSellerSettlement(
  prisma: ReturnEntitlementClient,
  input: PrepareFoundationReturnSellerSettlementInput
): Promise<PrepareFoundationReturnSellerSettlementResult> {
  if (!isSafeNonnegativeInt(input.originalSaleTransferCents) || !isSafeNonnegativeInt(input.entitlementAmountCents)) {
    throw new FoundationReturnEntitlementCausalError(
      "originalSaleTransferCents and entitlementAmountCents must be safe nonnegative integers"
    );
  }
  if (input.entitlementAmountCents > input.originalSaleTransferCents) {
    throw new FoundationReturnEntitlementCausalError(
      `entitlementAmountCents ${input.entitlementAmountCents} exceeds originalSaleTransferCents ${input.originalSaleTransferCents}`
    );
  }
  if (input.originalSaleTransferCents === 0 && input.entitlementAmountCents !== 0) {
    throw new FoundationReturnEntitlementCausalError(
      "entitlementAmountCents must be 0 when originalSaleTransferCents is 0"
    );
  }
  const currency = normalizeCurrency(input.currency);
  if (!currency) {
    throw new FoundationReturnEntitlementCausalError("currency is required");
  }
  const entitlementKey = foundationReturnEntitlementIdempotencyKey(input.storeOrderId);
  const saleKey = foundationTransferIdempotencyKey(input.storeOrderId);
  const expectedEntitlement = {
    storeOrderId: input.storeOrderId,
    memberId: input.memberId,
    storeReturnId: input.storeReturnId,
    amountCents: input.entitlementAmountCents,
    currency,
  };
  const expectedSale = {
    storeOrderId: input.storeOrderId,
    memberId: input.memberId,
    amountCents: input.originalSaleTransferCents,
    currency,
  };

  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, input.storeOrderId);
    await lockStoreReturnForUpdate(tx, input.storeReturnId);

    const order = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId } });
    if (!order) {
      throw new FoundationReturnEntitlementCausalError(`StoreOrder ${input.storeOrderId} not found`);
    }
    if (order.sellerId !== input.memberId) {
      throw new FoundationReturnEntitlementCausalError(
        `memberId ${input.memberId} is not the seller of StoreOrder ${input.storeOrderId}`
      );
    }

    const storeReturn = await tx.storeReturn.findUnique({ where: { id: input.storeReturnId } });
    if (!storeReturn || storeReturn.orderId !== input.storeOrderId) {
      throw new FoundationReturnEntitlementCausalError(
        `StoreReturn ${input.storeReturnId} does not belong to StoreOrder ${input.storeOrderId}`
      );
    }
    if (storeReturn.status !== "received") {
      throw new FoundationReturnEntitlementCausalError(
        `StoreReturn ${input.storeReturnId} must be received before seller settlement (status=${storeReturn.status})`
      );
    }

    const currentTo = await tx.transferOperation.findUnique({ where: { storeOrderId: input.storeOrderId } });
    if (currentTo) await lockTransferOperationForUpdate(tx, currentTo.id);
    const transfer = currentTo
      ? (await tx.transferOperation.findUnique({ where: { id: currentTo.id } })) ?? currentTo
      : null;

    const existingEntitlement = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: input.storeOrderId },
    });
    if (existingEntitlement) await lockEntitlementForUpdate(tx, existingEntitlement.id);
    const entitlementRow = existingEntitlement
      ? (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: existingEntitlement.id } })) ??
        existingEntitlement
      : null;

    const disposition = evaluateFoundationPayoutRefundDisposition({
      commerceStatus: order.commerceStatus,
      transferOperation: transfer,
    });
    throwIfBlocked(disposition, input.storeOrderId);

    if (disposition === "TRANSFER_SUCCEEDED" && transfer?.stripeTransferId) {
      if (entitlementRow) {
        throw new FoundationReturnEntitlementIntentConflictError(
          `StoreOrder ${input.storeOrderId} has a succeeded sale transfer and a seller-return entitlement row`
        );
      }
      return {
        kind: "ORIGINAL_TRANSFER_SUCCEEDED" as const,
        stripeTransferId: transfer.stripeTransferId,
        transferOperation: transfer,
      };
    }

    if (input.entitlementAmountCents === 0 && entitlementRow) {
      throw new FoundationReturnEntitlementIntentConflictError(
        `StoreOrder ${input.storeOrderId} has a seller-return entitlement row but entitlementAmountCents is 0`
      );
    }

    if (input.originalSaleTransferCents === 0) {
      return { kind: "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT" as const, transferOperation: null };
    }

    if (transfer && !saleTransferMatches(transfer, expectedSale)) {
      throw new FoundationTransferIntentConflictError(
        `TransferOperation intent conflict for StoreOrder ${input.storeOrderId}`
      );
    }

    let lockedTransfer = transfer;
    if (
      disposition === "NO_TRANSFER_ATTEMPTED" ||
      disposition === "DEFINITIVE_NO_TRANSFER" ||
      disposition === "PAYOUT_ALREADY_LOCKED_OUT"
    ) {
      if (!lockedTransfer) {
        try {
          lockedTransfer = await tx.transferOperation.create({
            data: {
              storeOrderId: input.storeOrderId,
              memberId: input.memberId,
              amountCents: input.originalSaleTransferCents,
              currency,
              providerIdempotencyKey: saleKey,
              status: "FAILED",
              lastError: ORDER_REFUNDED_BEFORE_TRANSFER,
              retryCount: 0,
              stripeTransferId: null,
            },
          });
        } catch (err) {
          if (!isPrismaKnown(err) || err.code !== "P2002") throw err;
          throw new FoundationTransferIntentConflictError(
            `TransferOperation intent conflict for StoreOrder ${input.storeOrderId}`
          );
        }
        await lockTransferOperationForUpdate(tx, lockedTransfer.id);
      } else if (lockedTransfer.lastError !== ORDER_REFUNDED_BEFORE_TRANSFER || lockedTransfer.status !== "FAILED") {
        lockedTransfer = await tx.transferOperation.update({
          where: { id: lockedTransfer.id },
          data: {
            status: "FAILED",
            lastError: ORDER_REFUNDED_BEFORE_TRANSFER,
            stripeTransferId: null,
          },
        });
      }
    } else {
      throw new FoundationTransferRefundBlockedError(
        disposition,
        `Foundation return seller settlement blocked: ${disposition} for StoreOrder ${input.storeOrderId}`
      );
    }

    if (input.entitlementAmountCents === 0) {
      return {
        kind: "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT" as const,
        transferOperation: lockedTransfer,
      };
    }

    const entitlement = await ensureEntitlementIntent(tx, {
      existing: entitlementRow,
      expected: expectedEntitlement,
      providerIdempotencyKey: entitlementKey,
    });

    return {
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT" as const,
      transferOperation: lockedTransfer,
      entitlement,
    };
  });
}

async function ensureEntitlementIntent(
  tx: Tx,
  args: {
    existing: SellerReturnEntitlementOperation | null;
    expected: {
      storeOrderId: string;
      memberId: string;
      storeReturnId: string;
      amountCents: number;
      currency: string;
    };
    providerIdempotencyKey: string;
  }
): Promise<SellerReturnEntitlementOperation> {
  if (args.existing) {
    if (!entitlementIntentMatches(args.existing, args.expected)) {
      throw new FoundationReturnEntitlementIntentConflictError(
        `SellerReturnEntitlementOperation intent conflict for StoreOrder ${args.expected.storeOrderId}`
      );
    }
    return args.existing;
  }

  try {
    const created = await tx.sellerReturnEntitlementOperation.create({
      data: {
        storeOrderId: args.expected.storeOrderId,
        memberId: args.expected.memberId,
        storeReturnId: args.expected.storeReturnId,
        amountCents: args.expected.amountCents,
        currency: args.expected.currency,
        providerIdempotencyKey: args.providerIdempotencyKey,
        status: "PENDING",
        retryCount: 0,
        stripeTransferId: null,
      },
    });
    return created;
  } catch (err) {
    if (!isPrismaKnown(err) || err.code !== "P2002") throw err;
    const raced = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: args.expected.storeOrderId },
    });
    if (!raced || !entitlementIntentMatches(raced, args.expected)) {
      throw new FoundationReturnEntitlementIntentConflictError(
        `SellerReturnEntitlementOperation intent conflict for StoreOrder ${args.expected.storeOrderId}`
      );
    }
    return raced;
  }
}

export const FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE = "return_entitlement";
export const FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT =
  "provider_snapshot_missing_after_attempt";

export type FoundationReturnEntitlementProviderSnapshot = {
  stripeDestinationAccountId: string;
  stripeSourceChargeId: string;
};

export type FoundationReturnEntitlementBeginAction =
  | { action: "needs_provider_snapshot"; operation: SellerReturnEntitlementOperation }
  | { action: "provider_create"; operation: SellerReturnEntitlementOperation }
  | { action: "already_succeeded"; operation: SellerReturnEntitlementOperation }
  | { action: "skip_failed"; operation: SellerReturnEntitlementOperation }
  | { action: "skip_in_flight"; operation: SellerReturnEntitlementOperation }
  | { action: "operator_required"; operation: SellerReturnEntitlementOperation; reason: string }
  | { action: "not_found" };

export type FoundationReturnEntitlementPreflightFailureResult =
  | { kind: "failed"; operation: SellerReturnEntitlementOperation }
  | { kind: "state_changed"; operation: SellerReturnEntitlementOperation }
  | { kind: "not_found" };

function hasFrozenProviderSnapshot(row: SellerReturnEntitlementOperation): boolean {
  return Boolean(row.stripeDestinationAccountId?.trim() && row.stripeSourceChargeId?.trim());
}

function isFirstProviderAttempt(row: SellerReturnEntitlementOperation): boolean {
  return row.status === "PENDING" && row.retryCount === 0 && !hasFrozenProviderSnapshot(row);
}

function normalizeProviderSnapshot(
  snapshot: FoundationReturnEntitlementProviderSnapshot
): FoundationReturnEntitlementProviderSnapshot {
  const stripeDestinationAccountId = snapshot.stripeDestinationAccountId.trim();
  const stripeSourceChargeId = snapshot.stripeSourceChargeId.trim();
  if (!stripeDestinationAccountId || !stripeSourceChargeId) {
    throw new FoundationReturnEntitlementCausalError(
      "provider snapshot destination and source charge must be non-empty"
    );
  }
  return { stripeDestinationAccountId, stripeSourceChargeId };
}

/**
 * Provider-attempt lock order (never invert; no TransferOperation / StoreReturn lock):
 * StoreOrder FOR UPDATE → SellerReturnEntitlementOperation FOR UPDATE.
 * Stripe network stays outside this transaction.
 *
 * First attempt (PENDING retryCount 0, no snapshot) returns needs_provider_snapshot
 * with no mutation unless a candidate snapshot is provided; freeze happens atomically
 * with PROCESSING / retryCount increment under this lock.
 */
export async function beginFoundationReturnEntitlementAttempt(
  prisma: ReturnEntitlementClient,
  args: {
    storeOrderId: string;
    now?: Date;
    providerSnapshot?: FoundationReturnEntitlementProviderSnapshot;
  }
): Promise<FoundationReturnEntitlementBeginAction> {
  const now = args.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: args.storeOrderId } });
    if (!order) return { action: "not_found" as const };

    const current = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: args.storeOrderId },
    });
    if (!current) return { action: "not_found" as const };

    await lockEntitlementForUpdate(tx, current.id);
    const operation =
      (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: current.id } })) ?? current;

    if (operation.memberId !== order.sellerId) {
      throw new FoundationReturnEntitlementCausalError(
        `SellerReturnEntitlementOperation seller ${operation.memberId} does not match StoreOrder seller ${order.sellerId}`
      );
    }

    if (operation.status === "SUCCEEDED") {
      if (!operation.stripeTransferId) {
        return {
          action: "operator_required" as const,
          operation,
          reason: FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
        };
      }
      return { action: "already_succeeded" as const, operation };
    }

    if (operation.status === "FAILED") {
      return { action: "skip_failed" as const, operation };
    }

    if (isFirstProviderAttempt(operation)) {
      if (!args.providerSnapshot) {
        return { action: "needs_provider_snapshot" as const, operation };
      }
      const frozen = normalizeProviderSnapshot(args.providerSnapshot);
      const next = await tx.sellerReturnEntitlementOperation.update({
        where: { id: operation.id },
        data: {
          status: "PROCESSING",
          retryCount: { increment: 1 },
          lastAttemptAt: now,
          lastError: null,
          stripeDestinationAccountId: frozen.stripeDestinationAccountId,
          stripeSourceChargeId: frozen.stripeSourceChargeId,
        },
      });
      return { action: "provider_create" as const, operation: next };
    }

    if (operation.status === "PROCESSING") {
      const age = operation.lastAttemptAt
        ? now.getTime() - operation.lastAttemptAt.getTime()
        : Number.POSITIVE_INFINITY;
      if (age < FOUNDATION_TRANSFER_PROCESSING_STALE_MS) {
        return { action: "skip_in_flight" as const, operation };
      }
    }

    if (!hasFrozenProviderSnapshot(operation)) {
      const missing =
        operation.status === "UNCERTAIN" &&
        operation.lastError === FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT
          ? operation
          : await tx.sellerReturnEntitlementOperation.update({
              where: { id: operation.id },
              data: {
                status: "UNCERTAIN",
                lastError: FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
                lastAttemptAt: operation.lastAttemptAt ?? now,
              },
            });
      return {
        action: "operator_required" as const,
        operation: missing,
        reason: FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
      };
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
        const aged = await tx.sellerReturnEntitlementOperation.update({
          where: { id: operation.id },
          data: { status: "UNCERTAIN", lastError: operation.lastError ?? "provider_outcome_uncertain" },
        });
        return { action: "operator_required" as const, operation: aged, reason: "uncertain_replay_window_elapsed" };
      }
      return { action: "operator_required" as const, operation, reason: "uncertain_replay_window_elapsed" };
    }

    const next = await tx.sellerReturnEntitlementOperation.update({
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

export async function persistFoundationReturnEntitlementSuccess(
  prisma: ReturnEntitlementClient,
  args: { storeOrderId: string; stripeTransferId: string }
): Promise<SellerReturnEntitlementOperation> {
  const stripeTransferId = args.stripeTransferId.trim();
  if (!stripeTransferId) {
    throw new FoundationTransferOperatorRequiredError(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
  }
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: args.storeOrderId },
    });
    if (!current) {
      throw new FoundationTransferOperatorRequiredError(
        `SellerReturnEntitlementOperation missing for StoreOrder ${args.storeOrderId}`
      );
    }
    await lockEntitlementForUpdate(tx, current.id);
    const locked =
      (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: current.id } })) ?? current;

    if (locked.status === "SUCCEEDED") {
      if (locked.stripeTransferId && locked.stripeTransferId !== stripeTransferId) {
        throw new FoundationReturnEntitlementIntentConflictError(
          `SellerReturnEntitlementOperation already succeeded with a different Stripe transfer for ${args.storeOrderId}`
        );
      }
      if (!locked.stripeTransferId) {
        throw new FoundationTransferOperatorRequiredError(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
      }
      return locked;
    }

    return tx.sellerReturnEntitlementOperation.update({
      where: { id: locked.id },
      data: {
        stripeTransferId,
        status: "SUCCEEDED",
        succeededAt: new Date(),
        lastError: null,
      },
    });
  });
}

export async function persistFoundationReturnEntitlementOutcome(
  prisma: ReturnEntitlementClient,
  args: { storeOrderId: string; status: "FAILED" | "UNCERTAIN"; lastError: string }
): Promise<SellerReturnEntitlementOperation> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: args.storeOrderId },
    });
    if (!current) {
      throw new FoundationTransferOperatorRequiredError(
        `SellerReturnEntitlementOperation missing for StoreOrder ${args.storeOrderId}`
      );
    }
    await lockEntitlementForUpdate(tx, current.id);
    const locked =
      (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: current.id } })) ?? current;
    if (locked.status === "SUCCEEDED") {
      if (locked.stripeTransferId) return locked;
      throw new FoundationTransferOperatorRequiredError(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
    }
    return tx.sellerReturnEntitlementOperation.update({
      where: { id: locked.id },
      data: {
        status: args.status,
        lastError: args.lastError.slice(0, 2000),
        lastAttemptAt: locked.lastAttemptAt ?? new Date(),
      },
    });
  });
}

/**
 * First-attempt missing-prerequisite failure. Persists FAILED only while the
 * locked row still proves no provider attempt: PENDING, retryCount 0, no snapshot.
 * Lock order: StoreOrder FOR UPDATE → entitlement FOR UPDATE.
 */
export async function persistFoundationReturnEntitlementPreflightFailure(
  prisma: ReturnEntitlementClient,
  args: { storeOrderId: string; lastError: string }
): Promise<FoundationReturnEntitlementPreflightFailureResult> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: args.storeOrderId },
    });
    if (!current) return { kind: "not_found" as const };

    await lockEntitlementForUpdate(tx, current.id);
    const locked =
      (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: current.id } })) ?? current;

    if (!isFirstProviderAttempt(locked)) {
      return { kind: "state_changed" as const, operation: locked };
    }

    const failed = await tx.sellerReturnEntitlementOperation.update({
      where: { id: locked.id },
      data: {
        status: "FAILED",
        lastError: args.lastError.slice(0, 2000),
        lastAttemptAt: locked.lastAttemptAt ?? new Date(),
      },
    });
    return { kind: "failed" as const, operation: failed };
  });
}

/**
 * Ledger lock order (never invert; no Stripe inside TX):
 * StoreOrder FOR UPDATE → entitlement FOR UPDATE → existing SellerBalanceTransaction lookup
 * → SellerBalance upsert → SellerBalanceTransaction insert.
 */
export async function completeFoundationSellerReturnEntitlementLedger(
  prisma: ReturnEntitlementClient,
  input: { storeOrderId: string }
): Promise<{ ledgerCreated: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, input.storeOrderId);
    const order = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId } });
    if (!order) {
      throw new FoundationTransferOperatorRequiredError(
        `StoreOrder missing for return entitlement ledger ${input.storeOrderId}`
      );
    }

    const operation = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: input.storeOrderId },
    });
    if (!operation) {
      throw new FoundationTransferOperatorRequiredError(
        `SellerReturnEntitlementOperation missing for StoreOrder ${input.storeOrderId}`
      );
    }
    await lockEntitlementForUpdate(tx, operation.id);
    const locked =
      (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: operation.id } })) ?? operation;

    if (locked.status !== "SUCCEEDED" || !locked.stripeTransferId) {
      throw new FoundationTransferOperatorRequiredError(
        `Cannot credit return entitlement ledger for StoreOrder ${input.storeOrderId} without a succeeded entitlement transfer`
      );
    }
    if (locked.memberId !== order.sellerId) {
      throw new FoundationReturnEntitlementCausalError(
        `SellerReturnEntitlementOperation seller ${locked.memberId} does not match StoreOrder seller ${order.sellerId}`
      );
    }

    const ledgerRows = await tx.sellerBalanceTransaction.findMany({
      where: { orderId: order.id, type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (locked.amountCents <= 0) {
      const none = classifySellerBalanceLedgerEvidence({
        expected: { expected: false },
        rows: ledgerRows,
      });
      if (isFoundationReturnLedgerAnomaly(none.classification)) {
        throw new FoundationReturnEntitlementIntentConflictError(
          `Existing return_entitlement ledger conflicts for StoreOrder ${order.id} (${none.classification})`
        );
      }
      return { ledgerCreated: false };
    }

    const evidence = classifySellerBalanceLedgerEvidence({
      expected: {
        expected: true,
        memberId: locked.memberId,
        amountCents: locked.amountCents,
        matchStripeTransferId: true,
        expectedStripeTransferId: locked.stripeTransferId,
      },
      rows: ledgerRows,
    });

    if (evidence.classification === "EXACT") {
      return { ledgerCreated: false };
    }
    if (evidence.classification !== "MISSING") {
      throw new FoundationReturnEntitlementIntentConflictError(
        `Existing return_entitlement ledger conflicts for StoreOrder ${order.id} (${evidence.classification})`
      );
    }

    await tx.sellerBalance.upsert({
      where: { memberId: locked.memberId },
      create: {
        memberId: locked.memberId,
        balanceCents: locked.amountCents,
        totalEarnedCents: locked.amountCents,
      },
      update: {
        balanceCents: { increment: locked.amountCents },
        totalEarnedCents: { increment: locked.amountCents },
      },
    });
    await tx.sellerBalanceTransaction.create({
      data: {
        memberId: locked.memberId,
        type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
        amountCents: locked.amountCents,
        orderId: order.id,
        description: `Return entitlement: Order #${order.id.slice(-6)}`,
        stripeTransferId: locked.stripeTransferId,
      },
    });
    return { ledgerCreated: true };
  });
}

export type FoundationReturnEntitlementResetBlockedReason =
  | "NOT_FAILED"
  | "PENDING"
  | "PROCESSING"
  | "UNCERTAIN"
  | "SUCCEEDED"
  | "REPLAY_WINDOW_EXPIRED"
  | "SNAPSHOT_MISSING";

export type FoundationReturnEntitlementResetEligibility =
  | { allowed: true }
  | { allowed: false; reason: FoundationReturnEntitlementResetBlockedReason };

/**
 * Shared FAILED-reset eligibility for admin read model and the locked reset writer.
 * retryCount 0: first provider attempt has not begun; window does not apply.
 * retryCount >= 1: same-key replay helper on createdAt; missing frozen snapshot is refused.
 */
export function evaluateFoundationReturnEntitlementResetEligibility(args: {
  status: string;
  retryCount: number;
  createdAt: Date;
  stripeDestinationAccountId: string | null;
  stripeSourceChargeId: string | null;
  now?: Date;
}): FoundationReturnEntitlementResetEligibility {
  if (args.status !== "FAILED") {
    if (
      args.status === "PENDING" ||
      args.status === "PROCESSING" ||
      args.status === "UNCERTAIN" ||
      args.status === "SUCCEEDED"
    ) {
      return { allowed: false, reason: args.status };
    }
    return { allowed: false, reason: "NOT_FAILED" };
  }

  const hasSnapshot = Boolean(
    args.stripeDestinationAccountId?.trim() && args.stripeSourceChargeId?.trim()
  );
  if (args.retryCount >= 1 && !hasSnapshot) {
    return { allowed: false, reason: "SNAPSHOT_MISSING" };
  }

  if (
    !isFoundationSameKeyReplayAllowed({
      retryCount: args.retryCount,
      createdAt: args.createdAt,
      now: args.now,
    })
  ) {
    return { allowed: false, reason: "REPLAY_WINDOW_EXPIRED" };
  }

  return { allowed: true };
}

export type FoundationReturnEntitlementAdminState = {
  operationId: string;
  storeOrderId: string;
  storeReturnId: string;
  sellerId: string;
  amountCents: number;
  currency: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  succeededAt: Date | null;
  stripeTransferId: string | null;
  stripeDestinationAccountId: string | null;
  stripeSourceChargeId: string | null;
  providerIdempotencyKey: string;
  resetAllowed: boolean;
  resetBlockedReason: FoundationReturnEntitlementResetBlockedReason | null;
  context: {
    storeReturnStatus: string | null;
    storeOrderStatus: string | null;
    transferOperationStatus: string | null;
    transferStripeTransferId: string | null;
    refundOperationStatus: string | null;
    refundStripeRefundId: string | null;
  };
};

function eligibilityFromOperation(
  operation: SellerReturnEntitlementOperation,
  now?: Date
): FoundationReturnEntitlementResetEligibility {
  return evaluateFoundationReturnEntitlementResetEligibility({
    status: operation.status,
    retryCount: operation.retryCount,
    createdAt: operation.createdAt,
    stripeDestinationAccountId: operation.stripeDestinationAccountId,
    stripeSourceChargeId: operation.stripeSourceChargeId,
    now,
  });
}

export async function getFoundationReturnEntitlementAdminState(
  prisma: PrismaClient,
  args: { storeOrderId: string; now?: Date }
): Promise<FoundationReturnEntitlementAdminState | null> {
  const operation = await prisma.sellerReturnEntitlementOperation.findUnique({
    where: { storeOrderId: args.storeOrderId },
  });
  if (!operation) return null;

  const eligibility = eligibilityFromOperation(operation, args.now);
  const [order, storeReturn, transfer, refund] = await Promise.all([
    prisma.storeOrder.findUnique({
      where: { id: operation.storeOrderId },
      select: { status: true, sellerId: true },
    }),
    prisma.storeReturn.findUnique({
      where: { id: operation.storeReturnId },
      select: { status: true },
    }),
    prisma.transferOperation.findUnique({
      where: { storeOrderId: operation.storeOrderId },
      select: { status: true, stripeTransferId: true },
    }),
    prisma.refundOperation.findUnique({
      where: { providerIdempotencyKey: foundationStorefrontRefundIdempotencyKey(operation.storeOrderId) },
      select: { status: true, stripeRefundId: true },
    }),
  ]);

  return {
    operationId: operation.id,
    storeOrderId: operation.storeOrderId,
    storeReturnId: operation.storeReturnId,
    sellerId: operation.memberId,
    amountCents: operation.amountCents,
    currency: operation.currency,
    status: operation.status,
    retryCount: operation.retryCount,
    lastError: operation.lastError,
    lastAttemptAt: operation.lastAttemptAt,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    succeededAt: operation.succeededAt,
    stripeTransferId: operation.stripeTransferId,
    stripeDestinationAccountId: operation.stripeDestinationAccountId,
    stripeSourceChargeId: operation.stripeSourceChargeId,
    providerIdempotencyKey: operation.providerIdempotencyKey,
    resetAllowed: eligibility.allowed,
    resetBlockedReason: eligibility.allowed ? null : eligibility.reason,
    context: {
      storeReturnStatus: storeReturn?.status ?? null,
      storeOrderStatus: order?.status ?? null,
      transferOperationStatus: transfer?.status ?? null,
      transferStripeTransferId: transfer?.stripeTransferId ?? null,
      refundOperationStatus: refund?.status ?? null,
      refundStripeRefundId: refund?.stripeRefundId ?? null,
    },
  };
}

export type FoundationReturnEntitlementResetResult =
  | { kind: "RESET"; operation: SellerReturnEntitlementOperation }
  | { kind: "NOT_FOUND" }
  | {
      kind: "NOT_FAILED";
      reason: Exclude<
        FoundationReturnEntitlementResetBlockedReason,
        "REPLAY_WINDOW_EXPIRED" | "SNAPSHOT_MISSING"
      >;
      operation: SellerReturnEntitlementOperation;
    }
  | { kind: "REPLAY_WINDOW_EXPIRED"; operation: SellerReturnEntitlementOperation }
  | { kind: "SNAPSHOT_MISSING"; operation: SellerReturnEntitlementOperation };

/**
 * Admin-only FAILED → PENDING. No Stripe. Preserves key, snapshot, retryCount, createdAt.
 * Lock order: StoreOrder FOR UPDATE → SellerReturnEntitlementOperation FOR UPDATE.
 */
export async function resetFoundationSellerReturnEntitlementForRetry(
  prisma: ReturnEntitlementClient,
  args: { storeOrderId: string; now?: Date }
): Promise<FoundationReturnEntitlementResetResult> {
  return prisma.$transaction(async (tx) => {
    await lockStoreOrderForUpdate(tx, args.storeOrderId);
    const current = await tx.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: args.storeOrderId },
    });
    if (!current) return { kind: "NOT_FOUND" as const };

    await lockEntitlementForUpdate(tx, current.id);
    const locked =
      (await tx.sellerReturnEntitlementOperation.findUnique({ where: { id: current.id } })) ?? current;

    const eligibility = eligibilityFromOperation(locked, args.now);
    if (!eligibility.allowed) {
      if (eligibility.reason === "REPLAY_WINDOW_EXPIRED") {
        return { kind: "REPLAY_WINDOW_EXPIRED" as const, operation: locked };
      }
      if (eligibility.reason === "SNAPSHOT_MISSING") {
        return { kind: "SNAPSHOT_MISSING" as const, operation: locked };
      }
      return { kind: "NOT_FAILED" as const, reason: eligibility.reason, operation: locked };
    }

    const next = await tx.sellerReturnEntitlementOperation.update({
      where: { id: locked.id },
      data: {
        status: "PENDING",
        lastError: OPERATOR_RESET_FOR_RETRY,
      },
    });
    return { kind: "RESET" as const, operation: next };
  });
}
