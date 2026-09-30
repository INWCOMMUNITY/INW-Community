import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listFoundationReturnSettlementCandidates,
  completeReceivedStoreReturnSettlement,
  foundationCheckoutReconciliationCronAllowed,
} = vi.hoisted(() => ({
  listFoundationReturnSettlementCandidates: vi.fn(),
  completeReceivedStoreReturnSettlement: vi.fn(),
  foundationCheckoutReconciliationCronAllowed: vi.fn(
    (mode: string | null | undefined) => mode === "FOUNDATION" || mode === "UNFROZEN"
  ),
}));

vi.mock("database", () => ({
  prisma: {},
  listFoundationReturnSettlementCandidates,
  foundationCheckoutReconciliationCronAllowed,
  FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE: 50,
}));

vi.mock("@/lib/store-return-settlement", () => ({
  completeReceivedStoreReturnSettlement,
}));

import { reconcileFoundationReturnSettlementBatch } from "./reconcile-foundation-return-settlements";

const stripe = {} as never;

function candidate(id: string) {
  return { storeReturnId: id, storeOrderId: `ord-${id}`, sellerId: `seller-${id}` };
}

describe("reconcileFoundationReturnSettlementBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFoundationReturnSettlementCandidates.mockResolvedValue([candidate("r1"), candidate("r2")]);
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "SETTLED",
      amountCents: 1000,
      newlyFinalized: true,
    });
  });

  it("skips non-Foundation writer modes without querying candidates", async () => {
    const summary = await reconcileFoundationReturnSettlementBatch({
      prisma: {} as never,
      stripe,
      mode: "LEGACY",
    });
    expect(summary).toMatchObject({ skipped: "mode_LEGACY", scanned: 0, settled: 0, errors: 0 });
    expect(listFoundationReturnSettlementCandidates).not.toHaveBeenCalled();
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
  });

  it("counts Unit-4 results without parsing error strings", async () => {
    listFoundationReturnSettlementCandidates.mockResolvedValue([
      candidate("a"),
      candidate("b"),
      candidate("c"),
      candidate("d"),
      candidate("e"),
      candidate("f"),
      candidate("g"),
      candidate("h"),
      candidate("i"),
    ]);
    completeReceivedStoreReturnSettlement
      .mockResolvedValueOnce({ kind: "SETTLED", amountCents: 1, newlyFinalized: true })
      .mockResolvedValueOnce({ kind: "ALREADY_COMPLETE", amountCents: 1 })
      .mockResolvedValueOnce({ kind: "NOT_RECEIVED", error: "x" })
      .mockResolvedValueOnce({ kind: "INVALID_AMOUNT", error: "x" })
      .mockResolvedValueOnce({ kind: "UNAUTHORIZED_SELLER", error: "x" })
      .mockResolvedValueOnce({ kind: "SELLER_SETTLEMENT_PENDING", error: "x", httpStatus: 500 })
      .mockResolvedValueOnce({ kind: "SELLER_SETTLEMENT_FAILED", error: "x", httpStatus: 409 })
      .mockResolvedValueOnce({ kind: "BUYER_REFUND_PENDING", error: "x", httpStatus: 500 })
      .mockResolvedValueOnce({
        kind: "BUYER_REFUND_FAILED",
        error: "Buyer refund replay window expired; operator recovery is required.",
        httpStatus: 409,
        reason: "replay_window_expired",
      });

    const summary = await reconcileFoundationReturnSettlementBatch({
      prisma: {} as never,
      stripe,
      mode: "FOUNDATION",
    });
    expect(summary).toEqual({
      skipped: null,
      scanned: 9,
      settled: 1,
      alreadyComplete: 1,
      notReceived: 1,
      invalidAmount: 1,
      unauthorizedSeller: 1,
      sellerPending: 1,
      sellerFailed: 1,
      buyerPending: 1,
      buyerFailed: 1,
      errors: 0,
    });
    expect(summary).not.toHaveProperty("operatorRequired");
  });

  it("HISTORICALLY_SETTLED replay counts as alreadyComplete, not errors", async () => {
    listFoundationReturnSettlementCandidates.mockResolvedValue([candidate("r1"), candidate("r2")]);
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "HISTORICALLY_SETTLED",
      amountCents: 1000,
    });
    const summary = await reconcileFoundationReturnSettlementBatch({
      prisma: {} as never,
      stripe,
      mode: "FOUNDATION",
    });
    expect(summary.alreadyComplete).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.settled).toBe(0);
  });

  it("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED surfaces as errors (operator block)", async () => {
    listFoundationReturnSettlementCandidates.mockResolvedValue([candidate("r1")]);
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED",
      amountCents: 1000,
      classification: "HISTORICAL_REFUND_AMBIGUOUS",
      reasonCodes: ["RETURN_DEBIT_MISSING"],
      error: "Historical refund compatibility requires operator review before seller settlement or buyer refund.",
    });
    const summary = await reconcileFoundationReturnSettlementBatch({
      prisma: {} as never,
      stripe,
      mode: "FOUNDATION",
    });
    expect(summary.errors).toBe(1);
    expect(summary.sellerPending).toBe(0);
    expect(summary.settled).toBe(0);
  });

  it("isolates a thrown candidate and continues the batch", async () => {
    completeReceivedStoreReturnSettlement.mockImplementation(async (args: { storeReturnId: string }) => {
      if (args.storeReturnId === "r1") throw new Error("boom");
      return { kind: "SETTLED", amountCents: 1000, newlyFinalized: true };
    });
    const summary = await reconcileFoundationReturnSettlementBatch({
      prisma: {} as never,
      stripe,
      mode: "FOUNDATION",
    });
    expect(summary.errors).toBe(1);
    expect(summary.settled).toBe(1);
    expect(summary.scanned).toBe(2);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledTimes(2);
  });

  it("does not start candidate #2 until candidate #1's settlement promise resolves", async () => {
    let firstResolved = false;
    let secondStartedBeforeFirstResolved = false;
    completeReceivedStoreReturnSettlement.mockImplementation(async (args: { storeReturnId: string }) => {
      if (args.storeReturnId === "r1") {
        await new Promise((resolve) => setTimeout(resolve, 40));
        firstResolved = true;
        return { kind: "SETTLED", amountCents: 1, newlyFinalized: true };
      }
      if (!firstResolved) secondStartedBeforeFirstResolved = true;
      return { kind: "ALREADY_COMPLETE", amountCents: 1 };
    });
    const summary = await reconcileFoundationReturnSettlementBatch({
      prisma: {} as never,
      stripe,
      mode: "UNFROZEN",
    });
    expect(secondStartedBeforeFirstResolved).toBe(false);
    expect(firstResolved).toBe(true);
    expect(summary.settled).toBe(1);
    expect(summary.alreadyComplete).toBe(1);
    expect(completeReceivedStoreReturnSettlement.mock.calls.map((c) => c[0].storeReturnId)).toEqual([
      "r1",
      "r2",
    ]);
  });
});
