import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID } from "../commerce-foundation-cutover";
import {
  beginFoundationTransferAttempt,
  classifyFoundationFailedTransferRetryability,
  classifyStripeTransferFailure,
  COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER,
  completeFoundationSellerPayoutLedger,
  completeFoundationStoreOrderPaid,
  ensureFoundationStorefrontRefundOperation,
  ensureFoundationTransferIntent,
  evaluateFoundationPayoutRefundDisposition,
  FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS,
  FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
  FOUNDATION_COMPATIBILITY_TRANSFER_ID_CONFLICT,
  foundationSellerPayoutRecoveryWhere,
  foundationStorefrontRefundIdempotencyKey,
  foundationSucceededPayoutLocalRepairOutstanding,
  foundationTransferIdempotencyKey,
  isFoundationSucceededPayoutLocalRepairEligible,
  listFoundationSucceededPayoutLocalRepairAttemptIds,
  FoundationRefundIntentConflictError,
  FoundationTransferIntentConflictError,
  FoundationTransferOperatorRequiredError,
  FoundationTransferRefundBlockedError,
  FoundationTransferResetError,
  isFoundationBuyerSaleCompleteStatus,
  isFoundationSameKeyReplayAllowed,
  isFoundationSellerPayoutEligibleOrderStatus,
  isPermanentFoundationNonconvertibleError,
  listFoundationPayoutReconciliation,
  lockFoundationPayoutOutForRefund,
  markFoundationAttemptUnfulfillable,
  markFoundationStoreOrderPaidAfterConvert,
  ORDER_REFUNDED_BEFORE_TRANSFER,
  persistFoundationRefundOutcome,
  persistFoundationRefundSuccess,
  persistFoundationTransferOutcome,
  persistFoundationTransferSuccess,
  resetFoundationTransferForOperatorRetry,
} from "../commerce-foundation-transfer";
import { FoundationCheckoutNotConvertibleError } from "../commerce-foundation-checkout";
import { FoundationInventoryError } from "../commerce-foundation-inventory";
import { foundationTestDatabaseUrl } from "./local-url";
import { createMember, createStoreItem } from "./fixtures";

let prisma: PrismaClient;

async function resetSingleton() {
  await prisma.$executeRaw`
    INSERT INTO "commerce_foundation_cutover" ("id", "mode", "updated_at")
    VALUES (${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID}, 'LEGACY', CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "mode" = 'LEGACY',
      "frozen_at" = NULL,
      "backfilled_at" = NULL,
      "foundation_at" = NULL,
      "unfrozen_at" = NULL,
      "engine_sha" = NULL,
      "manifest_hash" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

async function seedOrder() {
  const seller = await createMember(prisma, "xfer-s");
  const buyer = await createMember(prisma, "xfer-b");
  const item = await createStoreItem(prisma, seller.id, "Xfer item", { quantity: 1 });
  const attempt = await prisma.checkoutAttempt.create({
    data: {
      buyerMemberId: buyer.id,
      cartHash: `cart-${item.id}`,
      amountCents: 1000,
      stripeIdempotencyKey: `idem-xfer-${item.id}`,
      paymentStatus: "PAID",
      state: "PAID",
    },
  });
  const order = await prisma.storeOrder.create({
    data: {
      buyerId: buyer.id,
      sellerId: seller.id,
      totalCents: 1000,
      subtotalCents: 1000,
      checkoutAttemptId: attempt.id,
      commerceStatus: "FINALIZED",
      status: "pending",
    },
  });
  return { seller, buyer, attempt, order };
}

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterEach(async () => {
  await resetSingleton();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("foundation TransferOperation helpers", () => {
  it("classifies convert_underflow as permanent nonconvertible", () => {
    expect(isPermanentFoundationNonconvertibleError(new FoundationInventoryError("convert_underflow", "x"))).toBe(
      true
    );
    expect(isPermanentFoundationNonconvertibleError(new FoundationCheckoutNotConvertibleError("x"))).toBe(true);
    expect(isPermanentFoundationNonconvertibleError(new Error("timeout"))).toBe(false);
  });

  it("ensures one intent per StoreOrder and rejects conflicting amount", async () => {
    const { seller, order } = await seedOrder();
    const first = await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    expect(first.providerIdempotencyKey).toBe(foundationTransferIdempotencyKey(order.id));
    expect(first.status).toBe("PENDING");
    const again = await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    expect(again.id).toBe(first.id);
    await expect(
      ensureFoundationTransferIntent(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        amountCents: 500,
      })
    ).rejects.toBeInstanceOf(FoundationTransferIntentConflictError);
  });

  it("marks UNFULFILLABLE and fails unattempted transfer ops locally", async () => {
    const { attempt, order, seller } = await seedOrder();
    await prisma.storeOrder.update({ where: { id: order.id }, data: { commerceStatus: "PENDING" } });
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationAttemptUnfulfillable(prisma, attempt.id);
    const updated = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(updated?.commerceStatus).toBe("UNFULFILLABLE");
    expect(updated?.status).toBe("pending");
    const op = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(op?.status).toBe("FAILED");
    expect(op?.lastError).toBe(COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER);
    expect(op?.stripeTransferId).toBeNull();
    expect(op?.retryCount).toBe(0);
  });

  it("replays UNCERTAIN only while createdAt is within the absolute 23h horizon", async () => {
    const { seller, order } = await seedOrder();
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { createdAt: t0 },
    });
    const first = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t0 });
    expect(first.action).toBe("provider_create");
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "UNCERTAIN",
      lastError: "timeout",
    });

    const t20 = new Date(t0.getTime() + 20 * 60 * 60 * 1000);
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "UNCERTAIN", lastAttemptAt: t20, lastError: "timeout" },
    });
    const replay = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t20 });
    expect(replay.action).toBe("provider_create");
    if (replay.action === "provider_create") {
      expect(replay.operation.providerIdempotencyKey).toBe(foundationTransferIdempotencyKey(order.id));
    }

    const t30 = new Date(t0.getTime() + 30 * 60 * 60 * 1000);
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "UNCERTAIN", lastAttemptAt: t20, lastError: "timeout" },
    });
    const aged = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t30 });
    expect(aged.action).toBe("operator_required");
    expect(isFoundationSameKeyReplayAllowed({ retryCount: 2, createdAt: t0, now: t30 })).toBe(false);
  });

  it("treats stale PROCESSING as UNCERTAIN replay and skip in-flight PROCESSING", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "PROCESSING", lastAttemptAt: new Date() },
    });
    const inflight = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(inflight.action).toBe("skip_in_flight");

    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "PROCESSING", lastAttemptAt: new Date(Date.now() - 120_000) },
    });
    const stale = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(stale.action).toBe("provider_create");
  });

  it("persists success, completes paid and ledger once, and repairs missing projection", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_1" });
    const afterPersist = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(afterPersist?.stripeSellerTransferId).toBe("tr_1");
    expect(afterPersist?.status).toBe("pending");
    const first = await completeFoundationStoreOrderPaid(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
      stripeCheckoutSessionId: "cs_1",
      stripePaymentIntentId: "pi_1",
    });
    expect(first.paid).toBe(true);
    expect(first.ledgerCreated).toBe(true);
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { stripeSellerTransferId: null, status: "pending" },
    });
    const repaired = await completeFoundationStoreOrderPaid(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
    });
    expect(repaired.ledgerCreated).toBe(false);
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(after?.status).toBe("paid");
    expect(after?.stripeSellerTransferId).toBe("tr_1");
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(1);
  });

  it("fails closed when SUCCEEDED without Stripe transfer ID", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "SUCCEEDED", stripeTransferId: null },
    });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("operator_required");
    if (began.action === "operator_required") {
      expect(began.reason).toBe(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
    }
    await expect(
      completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 })
    ).rejects.toBeInstanceOf(FoundationTransferOperatorRequiredError);
    const paidAnyway = await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    expect(paidAnyway.paid).toBe(true);
  });

  it("payout FAILED after CONVERT does not restock or release", async () => {
    const { seller, order, attempt } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "no_such_destination",
    });
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { storeOrderId: order.id },
    });
    expect(reservation?.releasedQty ?? 0).toBe(0);
    expect(
      await prisma.inventoryEvent.count({
        where: {
          reservationId: reservation?.id ?? "__none__",
          eventType: { in: ["UNDO_CONSUMPTION", "PHYSICAL_RECEIPT", "RESERVATION_RELEASE"] },
        },
      })
    ).toBe(0);
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.commerceStatus).toBe("FINALIZED");
    expect(row?.status).toBe("paid");
    const attemptRow = await prisma.checkoutAttempt.findUnique({ where: { id: attempt.id } });
    expect(attemptRow?.paymentStatus).toBe("PAID");
  });

  it("persists FAILED/UNCERTAIN without unpaid transition; paid sale stays paid", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "no_such_destination",
    });
    const failed = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(failed.action).toBe("skip_failed");
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("paid");
    expect(row?.commerceStatus).toBe("FINALIZED");
    const listed = await listFoundationPayoutReconciliation(prisma, { statuses: ["FAILED"] });
    expect(listed.some((item) => item.storeOrderId === order.id)).toBe(true);
    expect(listed[0]?.memberId).toBeTruthy();
    expect(listed.every((item) => !("email" in item))).toBe(true);
  });

  it("concurrent intent ensure creates exactly one TransferOperation", async () => {
    const { seller, order } = await seedOrder();
    const [a, b] = await Promise.all([
      ensureFoundationTransferIntent(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        amountCents: 990,
      }),
      ensureFoundationTransferIntent(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        amountCents: 990,
      }),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.providerIdempotencyKey).toBe(b.providerIdempotencyKey);
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(1);
  });

  it("allows a first provider attempt for an old never-attempted PENDING intent", async () => {
    const { seller, order } = await seedOrder();
    const t0 = new Date("2026-02-01T00:00:00.000Z");
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "paid" } });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { createdAt: t0, retryCount: 0, status: "PENDING" },
    });
    const t48 = new Date(t0.getTime() + 48 * 60 * 60 * 1000);
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t48 });
    expect(began.action).toBe("provider_create");
  });

  it("marks the sale paid after CONVERT without waiting for TransferOperation SUCCEEDED", async () => {
    const { order } = await seedOrder();
    const marked = await markFoundationStoreOrderPaidAfterConvert(prisma, {
      storeOrderId: order.id,
      stripePaymentIntentId: "pi_paid",
    });
    expect(marked.paid).toBe(true);
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("paid");
    expect(row?.commerceStatus).toBe("FINALIZED");
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(0);
  });

  it("does not duplicate the paid transition or seller ledger", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_once" });
    const [a, b] = await Promise.all([
      markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id }),
      markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id }),
    ]);
    expect(a.paid).toBe(true);
    expect(b.paid).toBe(true);
    const [l1, l2] = await Promise.all([
      completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 }),
      completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 }),
    ]);
    expect([l1.ledgerCreated, l2.ledgerCreated].filter(Boolean).length).toBe(1);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(1);
  });

  it("locks out never-attempted payout before refund and cannot reset afterwards", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    const locked = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(locked.kind).toBe("LOCKED_OUT");
    const op = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(op?.status).toBe("FAILED");
    expect(op?.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    const later = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(later.action).toBe("skip_failed");
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toBeInstanceOf(
      FoundationTransferResetError
    );
  });

  it("refund vs payout begin: exactly one wins", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    const results = await Promise.all([
      lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id }).catch((err) => err),
      beginFoundationTransferAttempt(prisma, { storeOrderId: order.id }).catch((err) => err),
    ]);
    const lockResult = results.find(
      (row) => row && typeof row === "object" && "kind" in row
    ) as { kind: string } | undefined;
    const beginResult = results.find(
      (row) => row && typeof row === "object" && "action" in row
    ) as { action: string } | undefined;
    const blocked = results.find((row) => row instanceof FoundationTransferRefundBlockedError);
    const op = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    if (lockResult?.kind === "LOCKED_OUT") {
      expect(op?.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
      expect(op?.status).toBe("FAILED");
      expect(beginResult?.action === "skip_failed" || beginResult == null || blocked).toBeTruthy();
    } else {
      expect(blocked).toBeInstanceOf(FoundationTransferRefundBlockedError);
      expect(beginResult?.action).toBe("provider_create");
      expect(op?.status).toBe("PROCESSING");
    }
  });

  it("rejects automatic refund while payout is UNCERTAIN or PROCESSING", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "UNCERTAIN", lastError: "timeout", retryCount: 1 },
    });
    await expect(lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id })).rejects.toBeInstanceOf(
      FoundationTransferRefundBlockedError
    );
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { status: "PROCESSING", lastAttemptAt: new Date(), retryCount: 1 },
    });
    await expect(lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      disposition: "TRANSFER_IN_FLIGHT",
    });
  });

  it("allows refund lockout for definitive local FAILED with no transfer, then remains non-retryable", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    const locked = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(locked.kind).toBe("LOCKED_OUT");
    const op = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(op?.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      resetCode: "terminal_local",
    });
  });

  it("returns the Stripe transfer id for SUCCEEDED refund reversal", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_rev" });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    const guard = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(guard).toEqual({ kind: "TRANSFER_SUCCEEDED", stripeTransferId: "tr_rev" });
  });

  it("resets correctable FAILED to PENDING without minting a new key", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    const key = foundationTransferIdempotencyKey(order.id);
    const reset = await resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id });
    expect(reset.status).toBe("PENDING");
    expect(reset.providerIdempotencyKey).toBe(key);
    expect(reset.retryCount).toBe(0);
    const t48 = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await prisma.transferOperation.update({
      where: { id: reset.id },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t48 });
    expect(began.action).toBe("provider_create");
    if (began.action === "provider_create") {
      expect(began.operation.providerIdempotencyKey).toBe(key);
    }
  });

  it("rejects operator reset for unfulfillable and refunded-before-transfer", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "paid" } });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER,
    });
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      resetCode: "terminal_local",
    });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: ORDER_REFUNDED_BEFORE_TRANSFER,
    });
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      resetCode: "terminal_local",
    });
  });

  it("does not auto-replay after operator reset when createdAt is outside the horizon and retryCount >= 1", async () => {
    const { seller, order } = await seedOrder();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: {
        status: "FAILED",
        lastError: "missing_connect_account",
        retryCount: 1,
        createdAt: t0,
      },
    });
    const reset = await resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id });
    expect(reset.status).toBe("PENDING");
    expect(reset.retryCount).toBe(1);
    const t30 = new Date(t0.getTime() + 30 * 60 * 60 * 1000);
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t30 });
    expect(began.action).toBe("operator_required");
  });
});

describe("Prompt 80 shipped/delivered payout recovery and refund retry", () => {
  it("treats paid/shipped/delivered as payout-eligible and refunded/canceled as not", () => {
    expect(isFoundationSellerPayoutEligibleOrderStatus("paid")).toBe(true);
    expect(isFoundationSellerPayoutEligibleOrderStatus("shipped")).toBe(true);
    expect(isFoundationSellerPayoutEligibleOrderStatus("delivered")).toBe(true);
    expect(isFoundationSellerPayoutEligibleOrderStatus("pending")).toBe(false);
    expect(isFoundationSellerPayoutEligibleOrderStatus("refunded")).toBe(false);
    expect(isFoundationSellerPayoutEligibleOrderStatus("canceled")).toBe(false);
    expect(isFoundationBuyerSaleCompleteStatus("shipped")).toBe(true);
    expect(foundationSellerPayoutRecoveryWhere().OR).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "pending" })])
    );
  });

  it("resets a shipped FAILED payout and later pays the seller without regressing status", async () => {
    const { seller, order } = await seedOrder();
    const key = foundationTransferIdempotencyKey(order.id);
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "shipped" } });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    const reset = await resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id });
    expect(reset.status).toBe("PENDING");
    expect(reset.providerIdempotencyKey).toBe(key);
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("provider_create");
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_ship" });
    const ledger = await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
    });
    expect(ledger.ledgerCreated).toBe(true);
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("shipped");
    expect(row?.stripeSellerTransferId).toBe("tr_ship");
  });

  it("resets a delivered FAILED payout without rewriting delivered", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "delivered" } });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    const reset = await resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id });
    expect(reset.status).toBe("PENDING");
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_del" });
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("delivered");
  });

  it("begins payout for a shipped PENDING TransferOperation and preserves shipped", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "shipped" } });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("provider_create");
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_pending_ship" });
    await completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 });
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("shipped");
  });

  it("replays delivered UNCERTAIN inside the absolute horizon and preserves delivered", async () => {
    const { seller, order } = await seedOrder();
    const t0 = new Date("2026-04-01T00:00:00.000Z");
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "delivered" } });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { createdAt: t0, status: "UNCERTAIN", lastError: "timeout", retryCount: 1 },
    });
    const t20 = new Date(t0.getTime() + 20 * 60 * 60 * 1000);
    const replay = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t20 });
    expect(replay.action).toBe("provider_create");
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("delivered");
  });

  it("requires an operator for delivered UNCERTAIN outside the absolute horizon", async () => {
    const { seller, order } = await seedOrder();
    const t0 = new Date("2026-04-01T00:00:00.000Z");
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "delivered" } });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: { createdAt: t0, status: "UNCERTAIN", lastError: "timeout", retryCount: 1 },
    });
    const t30 = new Date(t0.getTime() + 30 * 60 * 60 * 1000);
    const aged = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id, now: t30 });
    expect(aged.action).toBe("operator_required");
    expect(aged.action === "provider_create").toBe(false);
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("delivered");
  });

  it("repairs SUCCEEDED projection and ledger after shipping without a new transfer identity", async () => {
    const { seller, order } = await seedOrder();
    const key = foundationTransferIdempotencyKey(order.id);
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_exist" });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { status: "shipped", stripeSellerTransferId: null },
    });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("already_succeeded");
    if (began.action === "already_succeeded") {
      expect(began.operation.providerIdempotencyKey).toBe(key);
    }
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: "tr_exist" });
    const first = await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
    });
    const second = await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
    });
    expect(first.ledgerCreated).toBe(true);
    expect(second.ledgerCreated).toBe(false);
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("shipped");
    expect(row?.stripeSellerTransferId).toBe("tr_exist");
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(1);
  });

  it("pays only the unresolved seller after both orders ship", async () => {
    const a = await seedOrder();
    const b = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: a.order.id,
      memberId: a.seller.id,
      amountCents: 990,
    });
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: b.order.id,
      memberId: b.seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: a.order.id });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: b.order.id });
    await persistFoundationTransferSuccess(prisma, { storeOrderId: a.order.id, stripeTransferId: "tr_a" });
    await completeFoundationSellerPayoutLedger(prisma, { storeOrderId: a.order.id, sellerCreditsCents: 990 });
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: b.order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    await prisma.storeOrder.update({ where: { id: a.order.id }, data: { status: "shipped" } });
    await prisma.storeOrder.update({ where: { id: b.order.id }, data: { status: "shipped" } });
    await resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: b.order.id });
    const beganB = await beginFoundationTransferAttempt(prisma, { storeOrderId: b.order.id });
    expect(beganB.action).toBe("provider_create");
    await persistFoundationTransferSuccess(prisma, { storeOrderId: b.order.id, stripeTransferId: "tr_b" });
    const aRow = await prisma.storeOrder.findUnique({ where: { id: a.order.id } });
    const bRow = await prisma.storeOrder.findUnique({ where: { id: b.order.id } });
    expect(aRow?.status).toBe("shipped");
    expect(bRow?.status).toBe("shipped");
    expect(aRow?.stripeSellerTransferId).toBe("tr_a");
    expect(bRow?.stripeSellerTransferId).toBe("tr_b");
    const beganA = await beginFoundationTransferAttempt(prisma, { storeOrderId: a.order.id });
    expect(beganA.action).toBe("already_succeeded");
  });

  it("does not pay or reset a refunded StoreOrder", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "refunded" } });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("skip_ineligible");
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      resetCode: "order_not_finalized_active_sale",
    });
  });

  it("does not pay or reset a canceled StoreOrder", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "canceled" } });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("skip_ineligible");
    await persistFoundationTransferOutcome(prisma, {
      storeOrderId: order.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      resetCode: "order_not_finalized_active_sale",
    });
  });

  it("re-enters refund lockout after order_refunded_before_transfer regardless of retryCount", async () => {
    const { seller, order } = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.transferOperation.update({
      where: { storeOrderId: order.id },
      data: {
        status: "FAILED",
        lastError: ORDER_REFUNDED_BEFORE_TRANSFER,
        retryCount: 3,
        stripeTransferId: null,
      },
    });
    expect(
      evaluateFoundationPayoutRefundDisposition({
        commerceStatus: "FINALIZED",
        transferOperation: {
          status: "FAILED",
          retryCount: 3,
          stripeTransferId: null,
          lastError: ORDER_REFUNDED_BEFORE_TRANSFER,
        },
      })
    ).toBe("PAYOUT_ALREADY_LOCKED_OUT");
    const locked = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(locked.kind).toBe("LOCKED_OUT");
    const op = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(op?.status).toBe("FAILED");
    expect(op?.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    expect(op?.retryCount).toBe(3);
    const later = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(later.action).toBe("skip_failed");
    await expect(resetFoundationTransferForOperatorRetry(prisma, { storeOrderId: order.id })).rejects.toMatchObject({
      resetCode: "terminal_local",
    });
  });

  it("keeps the transfer idempotency key unchanged across paid → shipped → delivered", async () => {
    const { seller, order } = await seedOrder();
    const first = await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "shipped" } });
    await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "delivered" } });
    const again = await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 990,
    });
    expect(again.providerIdempotencyKey).toBe(first.providerIdempotencyKey);
    expect(again.providerIdempotencyKey).toBe(foundationTransferIdempotencyKey(order.id));
  });

  it("lists shipped and delivered incomplete payouts for operator reconciliation", async () => {
    const shipped = await seedOrder();
    const delivered = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: shipped.order.id,
      memberId: shipped.seller.id,
      amountCents: 990,
    });
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: delivered.order.id,
      memberId: delivered.seller.id,
      amountCents: 990,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: shipped.order.id });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: delivered.order.id });
    await prisma.storeOrder.update({ where: { id: shipped.order.id }, data: { status: "shipped" } });
    await prisma.storeOrder.update({ where: { id: delivered.order.id }, data: { status: "delivered" } });
    const listed = await listFoundationPayoutReconciliation(prisma, { statuses: ["PENDING"] });
    expect(listed.some((item) => item.storeOrderId === shipped.order.id && item.orderStatus === "shipped")).toBe(true);
    expect(listed.some((item) => item.storeOrderId === delivered.order.id && item.orderStatus === "delivered")).toBe(
      true
    );
  });

  it("uses one durable storefront refund identity per StoreOrder and rejects amount conflicts", async () => {
    const { seller, order } = await seedOrder();
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    const first = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
    });
    expect(first.action).toBe("provider_create");
    expect(first.operation.providerIdempotencyKey).toBe(foundationStorefrontRefundIdempotencyKey(order.id));
    const retry = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "COURTESY",
      restockRequested: false,
    });
    expect(retry.operation.providerIdempotencyKey).toBe(first.operation.providerIdempotencyKey);
    expect(retry.operation.id).toBe(first.operation.id);
    await expect(
      ensureFoundationStorefrontRefundOperation(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        amountCents: 800,
        kind: "RETURN",
        restockRequested: true,
      })
    ).rejects.toBeInstanceOf(FoundationRefundIntentConflictError);
    await persistFoundationRefundOutcome(prisma, {
      storeOrderId: order.id,
      status: "UNCERTAIN",
      lastError: "timeout",
    });
    const afterTimeout = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
    });
    expect(afterTimeout.action).toBe("provider_create");
    expect(afterTimeout.operation.providerIdempotencyKey).toBe(first.operation.providerIdempotencyKey);
    await persistFoundationRefundSuccess(prisma, { storeOrderId: order.id, stripeRefundId: "re_1" });
    const already = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
    });
    expect(already.action).toBe("already_succeeded");
  });
});

describe("Foundation RefundOperation 23h same-key replay (real PostgreSQL)", () => {
  const windowMs = FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS;

  async function seedRefundRow(args: {
    status: "PENDING" | "PROCESSING" | "FAILED" | "UNCERTAIN" | "SUCCEEDED";
    retryCount: number;
    createdAt: Date;
    stripeRefundId?: string | null;
  }) {
    const { seller, order } = await seedOrder();
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: order.id });
    const key = foundationStorefrontRefundIdempotencyKey(order.id);
    const row = await prisma.refundOperation.create({
      data: {
        memberId: seller.id,
        storeOrderId: order.id,
        kind: "FULL",
        amountCents: 1000,
        currency: "usd",
        restockRequested: true,
        providerIdempotencyKey: key,
        status: args.status,
        retryCount: args.retryCount,
        createdAt: args.createdAt,
        stripeRefundId: args.stripeRefundId ?? undefined,
      },
    });
    return { seller, order, row, key };
  }

  it("allows a first provider attempt when retryCount is 0 even if createdAt is older than 23h", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date(createdAt.getTime() + windowMs + 60_000);
    const { seller, order, row, key } = await seedRefundRow({
      status: "PENDING",
      retryCount: 0,
      createdAt,
    });
    const begun = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
      now,
    });
    expect(begun.action).toBe("provider_create");
    expect(begun.operation.id).toBe(row.id);
    expect(begun.operation.providerIdempotencyKey).toBe(key);
    expect(begun.operation.retryCount).toBe(1);
    const persisted = await prisma.refundOperation.findUnique({ where: { id: row.id } });
    expect(persisted?.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(persisted?.providerIdempotencyKey).toBe(key);
  });

  it.each(["PROCESSING", "FAILED", "UNCERTAIN"] as const)(
    "retries %s with the same key inside the 23h window",
    async (status) => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const now = new Date(createdAt.getTime() + windowMs - 1000);
      const { seller, order, row, key } = await seedRefundRow({
        status,
        retryCount: 1,
        createdAt,
      });
      const begun = await ensureFoundationStorefrontRefundOperation(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        amountCents: 1000,
        kind: "FULL",
        restockRequested: true,
        now,
      });
      expect(begun.action).toBe("provider_create");
      expect(begun.operation.providerIdempotencyKey).toBe(key);
      expect(begun.operation.id).toBe(row.id);
      const persisted = await prisma.refundOperation.findUnique({ where: { id: row.id } });
      expect(persisted?.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(persisted?.providerIdempotencyKey).toBe(key);
    }
  );

  it.each(["PROCESSING", "FAILED", "UNCERTAIN"] as const)(
    "blocks %s replay after 23h without rotating the key or retryCount",
    async (status) => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const now = new Date(createdAt.getTime() + windowMs + 1);
      const { seller, order, row, key } = await seedRefundRow({
        status,
        retryCount: 1,
        createdAt,
      });
      const begun = await ensureFoundationStorefrontRefundOperation(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        amountCents: 1000,
        kind: "FULL",
        restockRequested: true,
        now,
      });
      expect(begun.action).toBe("replay_window_expired");
      expect(begun.operation.providerIdempotencyKey).toBe(key);
      const persisted = await prisma.refundOperation.findUnique({ where: { id: row.id } });
      expect(persisted?.status).toBe(status);
      expect(persisted?.retryCount).toBe(1);
      expect(persisted?.createdAt.toISOString()).toBe(createdAt.toISOString());
      expect(persisted?.providerIdempotencyKey).toBe(key);
    }
  );

  it("allows replay at exactly 23h and blocks 23h + 1ms", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const exact = new Date(createdAt.getTime() + windowMs);
    const inside = new Date(createdAt.getTime() + windowMs - 1000);
    const { seller, order } = await seedRefundRow({
      status: "FAILED",
      retryCount: 1,
      createdAt,
    });
    const atBoundary = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
      now: exact,
    });
    expect(atBoundary.action).toBe("provider_create");
    await prisma.refundOperation.update({
      where: { id: atBoundary.operation.id },
      data: { status: "FAILED", retryCount: 1 },
    });
    const justInside = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
      now: inside,
    });
    expect(justInside.action).toBe("provider_create");
    await prisma.refundOperation.update({
      where: { id: justInside.operation.id },
      data: { status: "FAILED", retryCount: 1 },
    });
    const expired = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
      now: new Date(createdAt.getTime() + windowMs + 1),
    });
    expect(expired.action).toBe("replay_window_expired");
  });

  it("does not mint a new refund when SUCCEEDED is missing stripeRefundId", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { seller, order, row, key } = await seedRefundRow({
      status: "SUCCEEDED",
      retryCount: 1,
      createdAt,
      stripeRefundId: null,
    });
    const begun = await ensureFoundationStorefrontRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
      kind: "FULL",
      restockRequested: true,
      now: new Date(createdAt.getTime() + 1000),
    });
    expect(begun.action).toBe("operator_required");
    if (begun.action === "operator_required") {
      expect(begun.reason).toBe("succeeded_without_stripe_refund_id");
    }
    const persisted = await prisma.refundOperation.findUnique({ where: { id: row.id } });
    expect(persisted?.status).toBe("SUCCEEDED");
    expect(persisted?.stripeRefundId).toBeNull();
    expect(persisted?.providerIdempotencyKey).toBe(key);
    expect(persisted?.retryCount).toBe(1);
  });
});

describe("classifyStripeTransferFailure", () => {
  it("classifies provider outcomes without overclaiming FAILED from generic 4xx", () => {
    expect(classifyStripeTransferFailure({ type: "StripeConnectionError" })).toBe("uncertain");
    expect(classifyStripeTransferFailure({ message: "timeout" })).toBe("uncertain");
    expect(classifyStripeTransferFailure({ type: "StripeAPIError", statusCode: 500 })).toBe("uncertain");
    expect(classifyStripeTransferFailure({ type: "StripeRateLimitError", statusCode: 429 })).toBe("uncertain");
    expect(classifyStripeTransferFailure({ type: "StripeAuthenticationError", statusCode: 401 })).toBe("uncertain");
    expect(classifyStripeTransferFailure({ type: "StripeInvalidRequestError", statusCode: 400, message: "bad" })).toBe(
      "uncertain"
    );
    expect(
      classifyStripeTransferFailure({
        type: "StripeInvalidRequestError",
        message: "Keys for idempotent requests can only be used with the same parameters",
      })
    ).toBe("uncertain");
    expect(classifyStripeTransferFailure({ type: "StripeIdempotencyError" })).toBe("uncertain");
    expect(
      classifyStripeTransferFailure({
        type: "StripeInvalidRequestError",
        code: "account_invalid",
        message: "account disabled",
      })
    ).toBe("failed");
    expect(
      classifyStripeTransferFailure({
        type: "StripeInvalidRequestError",
        code: "balance_insufficient",
      })
    ).toBe("failed");
    expect(
      classifyStripeTransferFailure({
        type: "StripeInvalidRequestError",
        message: "No such destination",
      })
    ).toBe("failed");
    expect(classifyStripeTransferFailure({ statusCode: 400, message: "generic 4xx" })).toBe("uncertain");
  });

  it("classifies FAILED retryability without a Prisma enum", () => {
    expect(classifyFoundationFailedTransferRetryability(COMMERCE_UNFULFILLABLE_BEFORE_TRANSFER)).toBe("TERMINAL_LOCAL");
    expect(classifyFoundationFailedTransferRetryability(ORDER_REFUNDED_BEFORE_TRANSFER)).toBe("TERMINAL_LOCAL");
    expect(classifyFoundationFailedTransferRetryability("missing_connect_account")).toBe("RETRYABLE_BY_OPERATOR");
    expect(evaluateFoundationPayoutRefundDisposition({ commerceStatus: "UNFULFILLABLE", transferOperation: null })).toBe(
      "UNFULFILLABLE"
    );
  });
});

describe("Prompt 82 SUCCEEDED local payout repair", () => {
  async function succeededWithoutLedger(status: "paid" | "shipped" | "delivered" = "paid") {
    const seeded = await seedOrder();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: seeded.order.id,
      memberId: seeded.seller.id,
      amountCents: 990,
    });
    await persistFoundationTransferSuccess(prisma, {
      storeOrderId: seeded.order.id,
      stripeTransferId: `tr_${seeded.order.id}`,
    });
    await markFoundationStoreOrderPaidAfterConvert(prisma, { storeOrderId: seeded.order.id });
    if (status !== "paid") {
      await prisma.storeOrder.update({ where: { id: seeded.order.id }, data: { status } });
    }
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: seeded.order.id, type: "sale" } })).toBe(0);
    return seeded;
  }

  it("treats SUCCEEDED + Stripe id as local-repair eligible without requiring a null compatibility ID", () => {
    expect(
      isFoundationSucceededPayoutLocalRepairEligible({
        commerceStatus: "FINALIZED",
        orderStatus: "paid",
        transferStatus: "SUCCEEDED",
        stripeTransferId: "tr_123",
      })
    ).toBe(true);
    expect(foundationSellerPayoutRecoveryWhere().OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transferOperation: { status: "SUCCEEDED", stripeTransferId: { not: null } },
        }),
      ])
    );
  });

  it("repairs missing sale ledger after SUCCEEDED persist without a new transfer identity", async () => {
    const { order } = await succeededWithoutLedger("paid");
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("already_succeeded");
    const first = await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
    });
    const second = await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: 990,
    });
    expect(first.ledgerCreated).toBe(true);
    expect(second.ledgerCreated).toBe(false);
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.status).toBe("paid");
    expect(row?.stripeSellerTransferId).toBe(`tr_${order.id}`);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(1);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: row!.sellerId } });
    expect(balance?.balanceCents).toBe(990);
  });

  it("repairs a missing compatibility ID together with the sale ledger", async () => {
    const { order } = await succeededWithoutLedger("paid");
    await prisma.storeOrder.update({ where: { id: order.id }, data: { stripeSellerTransferId: null } });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("already_succeeded");
    await persistFoundationTransferSuccess(prisma, { storeOrderId: order.id, stripeTransferId: `tr_${order.id}` });
    await completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 });
    const row = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(row?.stripeSellerTransferId).toBe(`tr_${order.id}`);
    expect(row?.status).toBe("paid");
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(1);
  });

  it("repairs shipped and delivered SUCCEEDED payouts without rewriting lifecycle", async () => {
    const shipped = await succeededWithoutLedger("shipped");
    await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: shipped.order.id,
      sellerCreditsCents: 990,
    });
    expect((await prisma.storeOrder.findUnique({ where: { id: shipped.order.id } }))?.status).toBe("shipped");

    const delivered = await succeededWithoutLedger("delivered");
    await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: delivered.order.id,
      sellerCreditsCents: 990,
    });
    expect((await prisma.storeOrder.findUnique({ where: { id: delivered.order.id } }))?.status).toBe("delivered");
  });

  it("repairs only the seller whose SUCCEEDED ledger is missing", async () => {
    const a = await succeededWithoutLedger("paid");
    const b = await succeededWithoutLedger("paid");
    await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: a.order.id,
      sellerCreditsCents: 990,
    });
    expect(
      await foundationSucceededPayoutLocalRepairOutstanding(prisma, b.attempt.id)
    ).toBe(true);
    await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: b.order.id,
      sellerCreditsCents: 990,
    });
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: a.order.id, type: "sale" } })).toBe(1);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: b.order.id, type: "sale" } })).toBe(1);
  });

  it("fails closed when the compatibility transfer ID conflicts", async () => {
    const { order } = await succeededWithoutLedger("paid");
    await prisma.storeOrder.update({ where: { id: order.id }, data: { stripeSellerTransferId: "tr_B" } });
    const began = await beginFoundationTransferAttempt(prisma, { storeOrderId: order.id });
    expect(began.action).toBe("operator_required");
    if (began.action === "operator_required") {
      expect(began.reason).toBe(FOUNDATION_COMPATIBILITY_TRANSFER_ID_CONFLICT);
    }
    await expect(
      completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 })
    ).rejects.toBeInstanceOf(FoundationTransferIntentConflictError);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })).toBe(0);
  });

  it("does not create a sale ledger for refunded, canceled, or UNFULFILLABLE orders", async () => {
    const refunded = await succeededWithoutLedger("paid");
    await prisma.storeOrder.update({ where: { id: refunded.order.id }, data: { status: "refunded" } });
    expect(await beginFoundationTransferAttempt(prisma, { storeOrderId: refunded.order.id })).toEqual({
      action: "skip_ineligible",
    });
    expect(
      await completeFoundationSellerPayoutLedger(prisma, {
        storeOrderId: refunded.order.id,
        sellerCreditsCents: 990,
      })
    ).toEqual({ ledgerCreated: false });

    const canceled = await succeededWithoutLedger("paid");
    await prisma.storeOrder.update({ where: { id: canceled.order.id }, data: { status: "canceled" } });
    expect(
      (await completeFoundationSellerPayoutLedger(prisma, {
        storeOrderId: canceled.order.id,
        sellerCreditsCents: 990,
      })).ledgerCreated
    ).toBe(false);

    const unfulfillable = await succeededWithoutLedger("paid");
    await prisma.storeOrder.update({
      where: { id: unfulfillable.order.id },
      data: { commerceStatus: "UNFULFILLABLE" },
    });
    expect(
      (await completeFoundationSellerPayoutLedger(prisma, {
        storeOrderId: unfulfillable.order.id,
        sellerCreditsCents: 990,
      })).ledgerCreated
    ).toBe(false);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: refunded.order.id, type: "sale" } })).toBe(0);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: canceled.order.id, type: "sale" } })).toBe(0);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: unfulfillable.order.id, type: "sale" } })).toBe(
      0
    );
  });

  it("discovers SUCCEEDED missing-ledger attempts for reconciliation", async () => {
    const { attempt, order } = await succeededWithoutLedger("paid");
    expect(await foundationSucceededPayoutLocalRepairOutstanding(prisma, attempt.id)).toBe(true);
    const ids = await listFoundationSucceededPayoutLocalRepairAttemptIds(prisma, 50);
    expect(ids).toContain(attempt.id);
    await completeFoundationSellerPayoutLedger(prisma, { storeOrderId: order.id, sellerCreditsCents: 990 });
    expect(await foundationSucceededPayoutLocalRepairOutstanding(prisma, attempt.id)).toBe(false);
    expect(await listFoundationSucceededPayoutLocalRepairAttemptIds(prisma, 50)).not.toContain(attempt.id);
  });
});
