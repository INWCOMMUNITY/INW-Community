import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  prepareFoundationReturnSellerSettlement,
  executeSellerReturnEntitlement,
  ensureStorefrontTransferReversal,
  executeStorefrontBuyerRefund,
  persistLocalStorefrontRefundCompletion,
  markStoreReturnRefundedOnce,
  FoundationReturnEntitlementCausalError,
  StorefrontReturnLedgerConflictError,
} = vi.hoisted(() => {
  class FoundationReturnEntitlementCausalError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FoundationReturnEntitlementCausalError";
    }
  }
  return {
    mockPrisma: {
      storeReturn: { findUnique: vi.fn() },
      storeOrder: { findUnique: vi.fn() },
    },
    prepareFoundationReturnSellerSettlement: vi.fn(),
    executeSellerReturnEntitlement: vi.fn(),
    ensureStorefrontTransferReversal: vi.fn(),
    executeStorefrontBuyerRefund: vi.fn(),
    persistLocalStorefrontRefundCompletion: vi.fn(),
    markStoreReturnRefundedOnce: vi.fn(),
    FoundationReturnEntitlementCausalError,
    StorefrontReturnLedgerConflictError: class StorefrontReturnLedgerConflictError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "StorefrontReturnLedgerConflictError";
      }
    },
  };
});

vi.mock("database", () => ({
  prisma: mockPrisma,
  prepareFoundationReturnSellerSettlement,
  FoundationReturnEntitlementCausalError,
  FoundationReturnEntitlementIntentConflictError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FoundationReturnEntitlementIntentConflictError";
    }
  },
  FoundationTransferIntentConflictError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FoundationTransferIntentConflictError";
    }
  },
  FoundationTransferRefundBlockedError: class extends Error {
    disposition: string;
    constructor(disposition: string, message: string) {
      super(message);
      this.name = "FoundationTransferRefundBlockedError";
      this.disposition = disposition;
    }
  },
}));

vi.mock("@/lib/stripe/seller-return-entitlement", () => ({ executeSellerReturnEntitlement }));
vi.mock("@/lib/stripe/refund-store-order", () => ({
  ensureStorefrontTransferReversal,
  executeStorefrontBuyerRefund,
  persistLocalStorefrontRefundCompletion,
  StorefrontReturnLedgerConflictError,
  isStorefrontReversalComplete: (status: string) =>
    status === "reversed" || status === "already_reversed" || status === "skipped",
}));
vi.mock("@/lib/store-return-receive", () => ({ markStoreReturnRefundedOnce }));

import { completeReceivedStoreReturnSettlement } from "./store-return-settlement";
import {
  postReturnSellerEntitlementCents,
  sellerTransferReversalCents,
} from "./store-return";
import { computeSellerTransferCents } from "./storefront-payout";

const stripe = {} as never;
const calls: string[] = [];

function sale100() {
  return {
    id: "ord-1",
    sellerId: "seller-1",
    status: "delivered",
    totalCents: 10000,
    subtotalCents: 10000,
    taxCents: 0,
    stripePaymentIntentId: "pi_1",
    inventoryRestoredAt: null,
    items: [{ id: "oi-1", storeItemId: "item-1", quantity: 1 }],
  };
}

function sale5() {
  return {
    ...sale100(),
    totalCents: 500,
    subtotalCents: 500,
  };
}

function ret100(overrides: Record<string, unknown> = {}) {
  return {
    id: "ret-1",
    orderId: "ord-1",
    status: "received",
    reason: "return_received",
    note: null,
    chargeReturnShipping: true,
    returnLabelCostCents: 1000,
    refundAmountCents: 9000,
    ...overrides,
  };
}

function ret5(overrides: Record<string, unknown> = {}) {
  return ret100({
    returnLabelCostCents: 900,
    refundAmountCents: 0,
    ...overrides,
  });
}

async function settle(order = sale100(), storeReturn = ret100()) {
  mockPrisma.storeOrder.findUnique.mockResolvedValue(order);
  mockPrisma.storeReturn.findUnique.mockResolvedValue(storeReturn);
  return completeReceivedStoreReturnSettlement({
    stripe,
    storeOrderId: "ord-1",
    storeReturnId: "ret-1",
    memberId: "seller-1",
  });
}

describe("completeReceivedStoreReturnSettlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    markStoreReturnRefundedOnce.mockResolvedValue(true);
    persistLocalStorefrontRefundCompletion.mockImplementation(async () => {
      calls.push("local");
    });
    executeStorefrontBuyerRefund.mockImplementation(async (args: { amountCents: number }) => {
      calls.push("refund");
      if (args.amountCents === 0) {
        return { status: "zero_amount", amountCents: 0, stripeRefund: null, alreadySucceeded: false };
      }
      return {
        status: "succeeded",
        amountCents: args.amountCents,
        stripeRefund: { id: "re_1", status: "succeeded" },
        alreadySucceeded: false,
      };
    });
    ensureStorefrontTransferReversal.mockImplementation(async () => {
      calls.push("reversal");
      return { status: "reversed", reversalId: "rev_1" };
    });
    executeSellerReturnEntitlement.mockImplementation(async () => {
      calls.push("entitlement");
      return {
        kind: "SUCCEEDED",
        operation: { id: "sreo_1", amountCents: 1000 },
        ledgerCreated: true,
        stripeTransferId: "tr_ent",
      };
    });
  });

  it("proves $100/$10 paid-first cents and order: reversal 8900 then refund 9000 then local", async () => {
    const original = computeSellerTransferCents(10000, 10000).sellerTransferCents;
    expect(original).toBe(9900);
    expect(sellerTransferReversalCents({ originalTransferCents: 9900, chargeReturnShipping: true, returnLabelCostCents: 1000 })).toBe(8900);
    expect(postReturnSellerEntitlementCents({ originalTransferCents: 9900, chargeReturnShipping: true, returnLabelCostCents: 1000 })).toBe(1000);
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: { id: "to_1" },
    });
    const result = await settle();
    expect(result).toEqual({ kind: "SETTLED", amountCents: 9000, newlyFinalized: true });
    expect(ensureStorefrontTransferReversal).toHaveBeenCalledWith(
      stripe,
      expect.objectContaining({ transferId: "tr_sale", storeOrderId: "ord-1", amountCents: 8900 })
    );
    expect(executeSellerReturnEntitlement).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 9000 }));
    expect(calls).toEqual(["reversal", "refund", "local"]);
    expect(markStoreReturnRefundedOnce).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ storeReturnId: "ret-1", amountCents: 9000 })
    );
  });

  it("proves $100/$10 return-first cents and order: entitlement 1000 then refund 9000 then local", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT",
      transferOperation: { id: "to_lock" },
      entitlement: { id: "sreo_1", amountCents: 1000 },
    });
    const result = await settle();
    expect(result.kind).toBe("SETTLED");
    expect(executeSellerReturnEntitlement).toHaveBeenCalledWith(stripe, expect.objectContaining({ storeOrderId: "ord-1" }));
    expect(ensureStorefrontTransferReversal).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 9000 }));
    expect(calls).toEqual(["entitlement", "refund", "local"]);
    expect(prepareFoundationReturnSellerSettlement).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        originalSaleTransferCents: 9900,
        entitlementAmountCents: 1000,
        storeReturnId: "ret-1",
      })
    );
  });

  it("proves $5/$9 paid-first: reversal 0, no entitlement, no Stripe refund, local complete", async () => {
    expect(computeSellerTransferCents(500, 500).sellerTransferCents).toBe(495);
    expect(sellerTransferReversalCents({ originalTransferCents: 495, chargeReturnShipping: true, returnLabelCostCents: 900 })).toBe(0);
    expect(postReturnSellerEntitlementCents({ originalTransferCents: 495, chargeReturnShipping: true, returnLabelCostCents: 900 })).toBe(495);
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: { id: "to_1" },
    });
    const result = await settle(sale5(), ret5());
    expect(result).toEqual({ kind: "SETTLED", amountCents: 0, newlyFinalized: true });
    expect(ensureStorefrontTransferReversal).toHaveBeenCalledWith(
      stripe,
      expect.objectContaining({ amountCents: 0 })
    );
    expect(executeSellerReturnEntitlement).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 0 }));
    expect(calls).toEqual(["reversal", "refund", "local"]);
  });

  it("proves $5/$9 return-first: entitlement 495, no reversal, no Stripe refund, local complete", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT",
      transferOperation: { id: "to_lock" },
      entitlement: { id: "sreo_1", amountCents: 495 },
    });
    const result = await settle(sale5(), ret5());
    expect(result.kind).toBe("SETTLED");
    expect(ensureStorefrontTransferReversal).not.toHaveBeenCalled();
    expect(executeSellerReturnEntitlement).toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 0 }));
    expect(calls).toEqual(["entitlement", "refund", "local"]);
    expect(prepareFoundationReturnSellerSettlement).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ originalSaleTransferCents: 495, entitlementAmountCents: 495 })
    );
  });

  it("proves full-refund zero-entitlement: no seller provider, then buyer refund, then local", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT",
      transferOperation: { id: "to_lock" },
    });
    const result = await settle(
      sale100(),
      ret100({ chargeReturnShipping: false, returnLabelCostCents: 1000, refundAmountCents: 10000 })
    );
    expect(result).toEqual({ kind: "SETTLED", amountCents: 10000, newlyFinalized: true });
    expect(executeSellerReturnEntitlement).not.toHaveBeenCalled();
    expect(ensureStorefrontTransferReversal).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 10000 }));
    expect(calls).toEqual(["refund", "local"]);
    expect(prepareFoundationReturnSellerSettlement).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ entitlementAmountCents: 0, originalSaleTransferCents: 9900 })
    );
  });

  it("historical SETTLED: stops before entitlement, reversal, and buyer refund", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "HISTORICALLY_SETTLED",
      storeOrderId: "ord_1",
      reasonCodes: ["HISTORICAL_REFUND_ALREADY_SETTLED"],
    });
    const result = await settle(sale100(), ret100({ refundAmountCents: 10000 }));
    expect(result).toEqual({ kind: "HISTORICALLY_SETTLED", amountCents: 10000 });
    expect(ensureStorefrontTransferReversal).not.toHaveBeenCalled();
    expect(executeSellerReturnEntitlement).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
  });

  it("historical AMBIGUOUS/ANOMALY: fail-closed review before provider or buyer refund", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED",
      storeOrderId: "ord_1",
      classification: "HISTORICAL_REFUND_AMBIGUOUS",
      reasonCodes: ["RETURN_DEBIT_MISSING"],
    });
    const result = await settle(sale100(), ret100({ refundAmountCents: 10000 }));
    expect(result).toEqual({
      kind: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED",
      amountCents: 10000,
      classification: "HISTORICAL_REFUND_AMBIGUOUS",
      reasonCodes: ["RETURN_DEBIT_MISSING"],
      error:
        "Historical refund compatibility requires operator review before seller settlement or buyer refund.",
    });
    expect(ensureStorefrontTransferReversal).not.toHaveBeenCalled();
    expect(executeSellerReturnEntitlement).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
  });

  it("does not buyer-refund when paid-first reversal is uncertain", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    ensureStorefrontTransferReversal.mockImplementation(async () => {
      calls.push("reversal");
      return { status: "uncertain", error: "timeout" };
    });
    const result = await settle();
    expect(result.kind).toBe("SELLER_SETTLEMENT_PENDING");
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
    expect(calls).toEqual(["reversal"]);
  });

  it("does not buyer-refund when paid-first reversal fails", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    ensureStorefrontTransferReversal.mockImplementation(async () => {
      calls.push("reversal");
      return { status: "failed", error: "transfer_closed" };
    });
    const result = await settle();
    expect(result.kind).toBe("SELLER_SETTLEMENT_FAILED");
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
  });

  it("reuses an already-succeeded reversal and continues to buyer refund", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    ensureStorefrontTransferReversal.mockImplementation(async () => {
      calls.push("reversal");
      return { status: "already_reversed", reversalId: "rev_1" };
    });
    const result = await settle();
    expect(result.kind).toBe("SETTLED");
    expect(ensureStorefrontTransferReversal).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["reversal", "refund", "local"]);
  });

  it.each([
    ["IN_FLIGHT", "SELLER_SETTLEMENT_PENDING"],
    ["FAILED", "SELLER_SETTLEMENT_FAILED"],
    ["UNCERTAIN", "SELLER_SETTLEMENT_PENDING"],
    ["REPLAY_WINDOW_EXPIRED", "SELLER_SETTLEMENT_FAILED"],
    ["NOT_FOUND", "SELLER_SETTLEMENT_FAILED"],
    ["FAILED_REQUIRES_RESET", "SELLER_SETTLEMENT_FAILED"],
    ["SUCCEEDED_WITHOUT_TRANSFER_ID", "SELLER_SETTLEMENT_FAILED"],
  ] as const)("entitlement %s blocks buyer refund (%s)", async (entitlementKind, expected) => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT",
      transferOperation: {},
      entitlement: {},
    });
    executeSellerReturnEntitlement.mockImplementation(async () => {
      calls.push("entitlement");
      return { kind: entitlementKind, operation: {} };
    });
    const result = await settle();
    expect(result.kind).toBe(expected);
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(calls).toEqual(["entitlement"]);
  });

  it("allows buyer refund after entitlement SUCCEEDED", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT",
      transferOperation: {},
      entitlement: {},
    });
    const result = await settle();
    expect(result.kind).toBe("SETTLED");
    expect(calls).toEqual(["entitlement", "refund", "local"]);
  });

  it("allows buyer refund after entitlement ALREADY_SUCCEEDED", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT",
      transferOperation: {},
      entitlement: {},
    });
    executeSellerReturnEntitlement.mockImplementation(async () => {
      calls.push("entitlement");
      return {
        kind: "ALREADY_SUCCEEDED",
        operation: {},
        ledgerCreated: false,
        stripeTransferId: "tr_ent",
      };
    });
    const result = await settle();
    expect(result.kind).toBe("SETTLED");
    expect(calls).toEqual(["entitlement", "refund", "local"]);
  });

  it("does not buyer-refund when entitlement ledger repair throws", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT",
      transferOperation: {},
      entitlement: {},
    });
    executeSellerReturnEntitlement.mockImplementation(async () => {
      calls.push("entitlement");
      throw new Error("ledger_repair_failed");
    });
    const result = await settle();
    expect(result.kind).toBe("SELLER_SETTLEMENT_PENDING");
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
  });

  it("does not locally finalize when buyer refund is uncertain after seller success", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    executeStorefrontBuyerRefund.mockImplementation(async () => {
      calls.push("refund");
      return { status: "uncertain", error: "timeout", httpStatus: 500 };
    });
    const result = await settle();
    expect(result.kind).toBe("BUYER_REFUND_PENDING");
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
    expect(calls).toEqual(["reversal", "refund"]);
  });

  it("does not locally finalize when buyer refund fails", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    executeStorefrontBuyerRefund.mockImplementation(async () => {
      calls.push("refund");
      return { status: "failed", error: "card_decline", httpStatus: 500 };
    });
    const result = await settle();
    expect(result.kind).toBe("BUYER_REFUND_FAILED");
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
  });

  it("maps buyer refund replay-window expiry to BUYER_REFUND_FAILED without local completion", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    executeStorefrontBuyerRefund.mockImplementation(async () => {
      calls.push("refund");
      return {
        status: "replay_window_expired",
        error: "Buyer refund replay window expired; operator recovery is required.",
        httpStatus: 409,
      };
    });
    const result = await settle();
    expect(result).toEqual({
      kind: "BUYER_REFUND_FAILED",
      error: "Buyer refund replay window expired; operator recovery is required.",
      httpStatus: 409,
      reason: "replay_window_expired",
    });
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
  });

  it("finalizes locally when buyer refund already succeeded without a second money movement", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    executeStorefrontBuyerRefund.mockImplementation(async () => {
      calls.push("refund");
      return {
        status: "succeeded",
        amountCents: 9000,
        stripeRefund: { id: "re_1", status: "succeeded" },
        alreadySucceeded: true,
      };
    });
    const result = await settle();
    expect(result.kind).toBe("SETTLED");
    expect(calls).toEqual(["reversal", "refund", "local"]);
  });

  it("completes a zero-dollar buyer refund without a Stripe refund object and still local-finalizes", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    const result = await settle(sale5(), ret5());
    expect(result.kind).toBe("SETTLED");
    expect(persistLocalStorefrontRefundCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ locallyComplete: true, stripeRefund: null, restockOperationId: "ret-1" })
    );
  });

  it("retries local finalize after a crash without duplicating settlement intent", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    persistLocalStorefrontRefundCompletion
      .mockImplementationOnce(async () => {
        calls.push("local");
        throw new Error("db_down");
      })
      .mockImplementationOnce(async () => {
        calls.push("local");
      });
    const first = await settle();
    expect(first.kind).toBe("BUYER_REFUND_PENDING");
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
    executeStorefrontBuyerRefund.mockImplementation(async () => {
      calls.push("refund");
      return {
        status: "succeeded",
        amountCents: 9000,
        stripeRefund: { id: "re_1" },
        alreadySucceeded: true,
      };
    });
    ensureStorefrontTransferReversal.mockImplementation(async () => {
      calls.push("reversal");
      return { status: "already_reversed", reversalId: "rev_1" };
    });
    const second = await settle();
    expect(second.kind).toBe("SETTLED");
    expect(ensureStorefrontTransferReversal).toHaveBeenCalledTimes(2);
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledTimes(2);
    expect(persistLocalStorefrontRefundCompletion).toHaveBeenCalledTimes(2);
    expect(persistLocalStorefrontRefundCompletion.mock.calls[0][0].restockOperationId).toBe("ret-1");
    expect(persistLocalStorefrontRefundCompletion.mock.calls[1][0].restockOperationId).toBe("ret-1");
    expect(markStoreReturnRefundedOnce).toHaveBeenCalledTimes(1);
  });

  it("returns ALREADY_COMPLETE with zero provider calls when StoreReturn is already refunded", async () => {
    const result = await settle(sale100(), ret100({ status: "refunded", refundAmountCents: 9000 }));
    expect(result).toEqual({ kind: "ALREADY_COMPLETE", amountCents: 9000 });
    expect(prepareFoundationReturnSellerSettlement).not.toHaveBeenCalled();
    expect(ensureStorefrontTransferReversal).not.toHaveBeenCalled();
    expect(executeSellerReturnEntitlement).not.toHaveBeenCalled();
    expect(executeStorefrontBuyerRefund).not.toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).not.toHaveBeenCalled();
  });

  it("does not hide StoreOrder refunded + StoreReturn received; finishes settlement", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    const result = await settle({ ...sale100(), status: "refunded", inventoryRestoredAt: new Date() }, ret100());
    expect(result.kind).toBe("SETTLED");
    expect(prepareFoundationReturnSellerSettlement).toHaveBeenCalled();
    expect(persistLocalStorefrontRefundCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ skipSellerLedgerDebit: false, restockOperationId: "ret-1" })
    );
    expect(markStoreReturnRefundedOnce).toHaveBeenCalled();
  });

  it("fails causally when StoreReturn is not received", async () => {
    for (const status of ["requested", "awaiting_return", "in_transit", "declined", "canceled"]) {
      const result = await settle(sale100(), ret100({ status }));
      expect(result.kind).toBe("NOT_RECEIVED");
    }
    expect(prepareFoundationReturnSellerSettlement).not.toHaveBeenCalled();
  });

  it("uses the snapshotted refund amount rather than recomputing", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    await settle(sale100(), ret100({ refundAmountCents: 8750 }));
    expect(executeStorefrontBuyerRefund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 8750 }));
    expect(markStoreReturnRefundedOnce).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ amountCents: 8750 })
    );
  });

  it("fails closed on a missing snapshotted refund amount", async () => {
    const result = await settle(sale100(), ret100({ refundAmountCents: null }));
    expect(result.kind).toBe("INVALID_AMOUNT");
    expect(prepareFoundationReturnSellerSettlement).not.toHaveBeenCalled();
  });

  it("rejects a seller who does not own the order", async () => {
    mockPrisma.storeOrder.findUnique.mockResolvedValue(sale100());
    mockPrisma.storeReturn.findUnique.mockResolvedValue(ret100());
    const result = await completeReceivedStoreReturnSettlement({
      stripe,
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      memberId: "other-seller",
    });
    expect(result.kind).toBe("UNAUTHORIZED_SELLER");
    expect(prepareFoundationReturnSellerSettlement).not.toHaveBeenCalled();
  });

  it("marks StoreReturn refunded only after local convergence", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    const order: string[] = [];
    persistLocalStorefrontRefundCompletion.mockImplementation(async () => {
      order.push("local");
    });
    markStoreReturnRefundedOnce.mockImplementation(async () => {
      order.push("return_refunded");
      return true;
    });
    await settle();
    expect(order).toEqual(["local", "return_refunded"]);
  });

  it("fails closed when local seller ledger evidence conflicts", async () => {
    prepareFoundationReturnSellerSettlement.mockResolvedValue({
      kind: "ORIGINAL_TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_sale",
      transferOperation: {},
    });
    persistLocalStorefrontRefundCompletion.mockRejectedValue(
      new StorefrontReturnLedgerConflictError(
        "Existing seller return ledger evidence conflicts with this refund; operator reconciliation is required"
      )
    );
    const result = await settle();
    expect(result).toEqual({
      kind: "BUYER_REFUND_FAILED",
      error:
        "Existing seller return ledger evidence conflicts with this refund; operator reconciliation is required",
      httpStatus: 409,
    });
    expect(markStoreReturnRefundedOnce).not.toHaveBeenCalled();
  });
});
