import { beforeEach, describe, expect, it, vi } from "vitest";
import { sellerLedgerDebitCents } from "./refund-store-order";

describe("sellerLedgerDebitCents", () => {
  it("matches the Connect transfer withheld from the seller on fulfill", () => {
    // $10 item, 1% reserve = 10 cents, no extra platform fee
    expect(sellerLedgerDebitCents({ totalCents: 1000, subtotalCents: 1000 })).toBe(990);
  });
});

const {
  mockPrisma,
  assertLegacyInteractiveMutationAllowed,
  restockOrderLinesAfterReturn,
  getCommerceFoundationCutoverState,
  lockFoundationPayoutOutForRefund,
  ensureFoundationStorefrontRefundOperation,
  persistFoundationRefundSuccess,
  persistFoundationRefundOutcome,
  foundationStorefrontRefundIdempotencyKey,
  loadHistoricalRefundRuntimeDecision,
  mustBlockHistoricalSellerFinancialMutation,
  runHistoricalExternalRefundRestockBranch,
  FoundationTransferRefundBlockedError,
  FoundationRefundIntentConflictError,
  CommerceFoundationCutoverBlockedError,
} = vi.hoisted(() => {
  class CommerceFoundationCutoverBlockedError extends Error {
    code = "inventory_cutover_frozen";
    retryable = true as const;
    httpStatus = 503 as const;
    constructor() {
      super("blocked");
      this.name = "CommerceFoundationCutoverBlockedError";
    }
  }
  class FoundationTransferRefundBlockedError extends Error {
    disposition: string;
    constructor(disposition: string, message: string) {
      super(message);
      this.name = "FoundationTransferRefundBlockedError";
      this.disposition = disposition;
    }
  }
  class FoundationRefundIntentConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FoundationRefundIntentConflictError";
    }
  }
  const loadHistoricalRefundRuntimeDecision = vi.fn(async () => ({
    action: "CONTINUE_ORDINARY_FOUNDATION" as const,
    classification: "NOT_HISTORICAL_LEGACY_REFUND" as const,
    reasonCodes: [] as string[],
    storeOrderId: "ord-1",
  }));
  const mustBlockHistoricalSellerFinancialMutation = vi.fn(
    (d: { action: string }) =>
      d.action === "HISTORICAL_FINANCIAL_NOOP" ||
      d.action === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED"
  );
  const runHistoricalExternalRefundRestockBranch = vi.fn(async () => ({
    handled: true,
    decision: {
      action: "HISTORICAL_FINANCIAL_NOOP",
      classification: "HISTORICAL_REFUND_ALREADY_SETTLED",
      reasonCodes: [],
      storeOrderId: "ord-1",
    },
    inventoryUpdated: true,
    sellerDebitApplied: false as const,
  }));
  return {
    mockPrisma: {
      storeOrder: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    },
    assertLegacyInteractiveMutationAllowed: vi.fn(async () => {}),
    getCommerceFoundationCutoverState: vi.fn(async () => ({ mode: "LEGACY" })),
    lockFoundationPayoutOutForRefund: vi.fn(async () => ({ kind: "LOCKED_OUT", operation: null })),
    ensureFoundationStorefrontRefundOperation: vi.fn(async (_db: unknown, args: { storeOrderId: string; amountCents: number }) => ({
      action: "provider_create" as const,
      operation: {
        id: "ro_1",
        storeOrderId: args.storeOrderId,
        amountCents: args.amountCents,
        currency: "usd",
        providerIdempotencyKey: `nwc_store_refund_${args.storeOrderId}`,
        stripeRefundId: null,
      },
    })),
    persistFoundationRefundSuccess: vi.fn(async () => ({})),
    persistFoundationRefundOutcome: vi.fn(async () => ({})),
    foundationStorefrontRefundIdempotencyKey: (id: string) => `nwc_store_refund_${id}`,
    restockOrderLinesAfterReturn: vi.fn(async () => ["item-1"]),
    loadHistoricalRefundRuntimeDecision,
    mustBlockHistoricalSellerFinancialMutation,
    runHistoricalExternalRefundRestockBranch,
    CommerceFoundationCutoverBlockedError,
    FoundationTransferRefundBlockedError,
    FoundationRefundIntentConflictError,
  };
});

vi.mock("database", async () => {
  const evidence = await import("../../../../../packages/database/src/commerce-foundation-return-ledger-evidence");
  return {
    prisma: mockPrisma,
    assertLegacyInteractiveMutationAllowed,
    getCommerceFoundationCutoverState,
    lockFoundationPayoutOutForRefund,
    ensureFoundationStorefrontRefundOperation,
    persistFoundationRefundSuccess,
    persistFoundationRefundOutcome,
    foundationStorefrontRefundIdempotencyKey,
    FoundationTransferRefundBlockedError,
    FoundationRefundIntentConflictError,
    commerceInventoryWriterRoute: (mode: string) =>
      mode === "LEGACY" ? "legacy" : mode === "FOUNDATION" || mode === "UNFROZEN" ? "foundation" : "blocked",
    CommerceFoundationCutoverBlockedError,
    classifySellerBalanceLedgerEvidence: evidence.classifySellerBalanceLedgerEvidence,
    isFoundationReturnLedgerAnomaly: evidence.isFoundationReturnLedgerAnomaly,
    loadHistoricalRefundRuntimeDecision,
    mustBlockHistoricalSellerFinancialMutation,
    runHistoricalExternalRefundRestockBranch,
  };
});

vi.mock("@/lib/store-item-restock", () => ({
  restockOrderLinesAfterReturn,
}));

import {
  executeStorefrontBuyerRefund,
  persistLocalStorefrontRefundCompletion,
  refundPaidStorefrontOrder,
  restockAfterExternalRefund,
  StorefrontReturnLedgerConflictError,
  storefrontTransferReversalIdempotencyKey,
} from "./refund-store-order";

const paidOrder = {
  id: "ord-1",
  sellerId: "seller-1",
  status: "paid",
  totalCents: 1000,
  subtotalCents: 1000,
  taxCents: 0,
  inventoryRestoredAt: null,
  cancelReason: null,
  refundInitiatedAt: null,
  stripePaymentIntentId: "pi_1",
  stripeSellerTransferId: "tr_1",
  items: [{ storeItemId: "item-1", quantity: 1, variant: null }],
};

type ReturnLedgerRow = {
  id?: string;
  memberId: string;
  amountCents: number;
  orderId: string;
  type: string;
  stripeTransferId?: string | null;
};

function persistLocalTxState(init?: {
  status?: string;
  sellerId?: string;
  inventoryRestoredAt?: Date | null;
  existingReturnLedger?: ReturnLedgerRow | ReturnLedgerRow[] | null;
}) {
  const orderRow = {
    id: "ord-1",
    sellerId: init?.sellerId ?? "seller-1",
    status: init?.status ?? "paid",
    inventoryRestoredAt: init?.inventoryRestoredAt ?? (null as Date | null),
  };
  const seeded = init?.existingReturnLedger
    ? Array.isArray(init.existingReturnLedger)
      ? init.existingReturnLedger
      : [init.existingReturnLedger]
    : [];
  const returnLedger: ReturnLedgerRow[] = seeded.map((row, i) => ({
    id: row.id ?? `sbt_seed_${i}`,
    ...row,
  }));
  let balanceCents = 0;
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    storeOrder: {
      findUnique: vi.fn(async () => ({ ...orderRow })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (typeof args.data.status === "string") orderRow.status = args.data.status;
        if (args.data.inventoryRestoredAt instanceof Date) {
          orderRow.inventoryRestoredAt = args.data.inventoryRestoredAt;
        }
        return {};
      }),
    },
    sellerBalance: {
      upsert: vi.fn(async (args: {
        create?: { balanceCents: number };
        update?: { balanceCents?: { decrement?: number } };
      }) => {
        const decrement = args.update?.balanceCents?.decrement;
        if (typeof decrement === "number") {
          if (balanceCents === 0 && returnLedger.length === 0 && args.create) {
            balanceCents = args.create.balanceCents;
          } else {
            balanceCents -= decrement;
          }
        } else if (args.create) {
          balanceCents = args.create.balanceCents;
        }
        return { balanceCents };
      }),
    },
    sellerBalanceTransaction: {
      findFirst: vi.fn(async (args: { where: { orderId: string; type: string } }) => {
        return returnLedger.find((row) => row.orderId === args.where.orderId && row.type === args.where.type) ?? null;
      }),
      findMany: vi.fn(async (args: { where: { orderId: string; type: string } }) => {
        return returnLedger.filter(
          (row) => row.orderId === args.where.orderId && row.type === args.where.type
        );
      }),
      create: vi.fn(async (args: { data: ReturnLedgerRow }) => {
        returnLedger.push({ ...args.data, type: args.data.type ?? "return" });
        return args.data;
      }),
    },
  };
  return { tx, orderRow, returnLedger, getBalance: () => balanceCents };
}

function mockPersistLocalTransaction(init?: Parameters<typeof persistLocalTxState>[0]) {
  const state = persistLocalTxState(init);
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(state.tx));
  return state;
}

const emptyReversalList = {
  object: "list" as const,
  data: [] as Array<{ id: string; amount: number; metadata?: Record<string, string> }>,
  has_more: false,
};

function stripeStub() {
  return {
    transfers: {
      createReversal: vi.fn().mockResolvedValue({ id: "rev_1", amount: 990 }),
      listReversals: vi.fn().mockResolvedValue(emptyReversalList),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_1", status: "succeeded", created: 1_700_000_000 }),
      list: vi.fn(),
    },
  };
}

function matchingReversalList(overrides?: { id?: string; amount?: number; refundOperationId?: string }) {
  return {
    object: "list" as const,
    data: [
      {
        id: overrides?.id ?? "rev_1",
        amount: overrides?.amount ?? 990,
        metadata: {
          storeOrderId: "ord-1",
          ...(overrides?.refundOperationId ? { refundOperationId: overrides.refundOperationId } : {}),
        },
      },
    ],
    has_more: false,
  };
}

describe("restockAfterExternalRefund cutover ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadHistoricalRefundRuntimeDecision.mockResolvedValue({
      action: "CONTINUE_ORDINARY_FOUNDATION",
      classification: "NOT_HISTORICAL_LEGACY_REFUND",
      reasonCodes: [],
      storeOrderId: "ord-1",
    });
    mustBlockHistoricalSellerFinancialMutation.mockImplementation(
      (d: { action: string }) =>
        d.action === "HISTORICAL_FINANCIAL_NOOP" ||
        d.action === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED"
    );
    runHistoricalExternalRefundRestockBranch.mockResolvedValue({
      handled: true,
      decision: {
        action: "HISTORICAL_FINANCIAL_NOOP",
        classification: "HISTORICAL_REFUND_ALREADY_SETTLED",
        reasonCodes: [],
        storeOrderId: "ord-1",
      },
      inventoryUpdated: true,
      sellerDebitApplied: false,
    });
    mockPrisma.storeOrder.findUnique.mockResolvedValue(paidOrder);
    mockPersistLocalTransaction();
  });

  it("FROZEN does not reverse Connect transfer or restock inventory", async () => {
    assertLegacyInteractiveMutationAllowed.mockRejectedValue(
      new CommerceFoundationCutoverBlockedError()
    );
    const stripe = stripeStub();

    await expect(restockAfterExternalRefund("ord-1", stripe as never)).rejects.toMatchObject({
      code: "inventory_cutover_frozen",
      retryable: true,
      httpStatus: 503,
    });

    expect(assertLegacyInteractiveMutationAllowed).toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("LEGACY reverses Connect transfer then restocks after the gate", async () => {
    const callOrder: string[] = [];
    assertLegacyInteractiveMutationAllowed.mockImplementation(async () => {
      callOrder.push("assert");
    });
    const stripe = stripeStub();
    stripe.transfers.createReversal.mockImplementation(async () => {
      callOrder.push("reverse");
      return { id: "rev_1" };
    });
    restockOrderLinesAfterReturn.mockImplementation(async () => {
      callOrder.push("restock");
      return ["item-1"];
    });

    await expect(restockAfterExternalRefund("ord-1", stripe as never)).resolves.toBe(true);

    expect(stripe.transfers.listReversals).toHaveBeenCalledWith("tr_1", { limit: 100 });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_1",
      { amount: 990, metadata: { storeOrderId: "ord-1" } },
      { idempotencyKey: "nwc_store_reversal_ord-1" }
    );
    expect(restockOrderLinesAfterReturn).toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(callOrder).toEqual(["assert", "reverse", "restock"]);
  });

  it("skips provider and restock when inventory was already restored", async () => {
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      ...paidOrder,
      inventoryRestoredAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const stripe = stripeStub();

    await expect(restockAfterExternalRefund("ord-1", stripe as never)).resolves.toBe(false);

    expect(assertLegacyInteractiveMutationAllowed).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("historical SETTLED: inventory converges without seller debit or reversal", async () => {
    loadHistoricalRefundRuntimeDecision.mockResolvedValue({
      action: "HISTORICAL_FINANCIAL_NOOP",
      classification: "HISTORICAL_REFUND_ALREADY_SETTLED",
      reasonCodes: ["HISTORICAL_REFUND_ALREADY_SETTLED"],
      storeOrderId: "ord-1",
    });
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      ...paidOrder,
      status: "refunded",
      inventoryRestoredAt: null,
    });
    const stripe = stripeStub();

    await expect(restockAfterExternalRefund("ord-1", stripe as never)).resolves.toBe(true);

    expect(loadHistoricalRefundRuntimeDecision).toHaveBeenCalledWith(mockPrisma, "ord-1");
    expect(runHistoricalExternalRefundRestockBranch).toHaveBeenCalled();
    expect(lockFoundationPayoutOutForRefund).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("historical AMBIGUOUS: no debit/reversal/lock; inventory branch still runs", async () => {
    loadHistoricalRefundRuntimeDecision.mockResolvedValue({
      action: "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED",
      classification: "HISTORICAL_REFUND_AMBIGUOUS",
      reasonCodes: ["RETURN_DEBIT_MISSING"],
      storeOrderId: "ord-1",
    });
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      ...paidOrder,
      status: "refunded",
      inventoryRestoredAt: null,
    });
    const stripe = stripeStub();

    await expect(restockAfterExternalRefund("ord-1", stripe as never)).resolves.toBe(true);

    expect(runHistoricalExternalRefundRestockBranch).toHaveBeenCalled();
    expect(lockFoundationPayoutOutForRefund).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("courtesy refund restock:false remains ungated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistLocalTransaction();
  });

  it("does not call the inventory cutover assertion", async () => {
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: paidOrder,
      restock: false,
    });
    expect(result).toEqual({ ok: true, refunded: true, amountCents: 1000 });
    expect(assertLegacyInteractiveMutationAllowed).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalled();
  });
});

describe("FOUNDATION TransferOperation-aware refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    ensureFoundationStorefrontRefundOperation.mockImplementation(async (_db: unknown, args: { storeOrderId: string; amountCents: number }) => ({
      action: "provider_create" as const,
      operation: {
        id: "ro_1",
        storeOrderId: args.storeOrderId,
        amountCents: args.amountCents,
        currency: "usd",
        providerIdempotencyKey: `nwc_store_refund_${args.storeOrderId}`,
        stripeRefundId: null,
      },
    }));
    mockPersistLocalTransaction();
  });

  it("locks out never-attempted payout then refunds the buyer without reversal", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({ kind: "LOCKED_OUT", operation: { lastError: "order_refunded_before_transfer" } });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(result).toEqual({ ok: true, refunded: true, amountCents: 1000 });
    expect(lockFoundationPayoutOutForRefund).toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalled();
  });

  it("fails closed on UNCERTAIN without refund or restock", async () => {
    lockFoundationPayoutOutForRefund.mockRejectedValue(
      new FoundationTransferRefundBlockedError("TRANSFER_UNCERTAIN", "blocked")
    );
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("fails closed on PROCESSING without refund", async () => {
    lockFoundationPayoutOutForRefund.mockRejectedValue(
      new FoundationTransferRefundBlockedError("TRANSFER_IN_FLIGHT", "blocked")
    );
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(false);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("SUCCEEDED payout refund reverses the TransferOperation Stripe id", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_from_op",
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(result.ok).toBe(true);
    expect(stripe.transfers.listReversals).toHaveBeenCalledWith("tr_from_op", { limit: 100 });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_from_op",
      {
        amount: 990,
        metadata: { storeOrderId: "ord-1", refundOperationId: "ro_1" },
      },
      { idempotencyKey: "nwc_store_reversal_ord-1" }
    );
    expect(stripe.refunds.create).toHaveBeenCalled();
  });

  it("retries after order_refunded_before_transfer lockout without reopening payout", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer", retryCount: 2, status: "FAILED" },
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(result.ok).toBe(true);
    expect(lockFoundationPayoutOutForRefund).toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalled();
  });

  it("uses a stable Stripe refund idempotency key across retries of the same causal refund", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    const stripe = stripeStub();
    await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
    expect(stripe.refunds.create.mock.calls[1][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
    expect(stripe.refunds.create.mock.calls[0][0]).toEqual(stripe.refunds.create.mock.calls[1][0]);
  });

  it("retries the same key after a definitive Stripe refund failure and restocks once on success", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    const stripe = stripeStub();
    stripe.refunds.create
      .mockRejectedValueOnce({ type: "StripeInvalidRequestError", message: "card_decline", statusCode: 400 })
      .mockResolvedValueOnce({ id: "re_2", status: "succeeded", created: 1_700_000_000 });
    const first = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(first.ok).toBe(false);
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(persistFoundationRefundOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "FAILED" })
    );
    const second = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(second.ok).toBe(true);
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual(stripe.refunds.create.mock.calls[1][1]);
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
  });

  it("retries the same key after a timeout and does not restock until provider success", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    const stripe = stripeStub();
    stripe.refunds.create.mockRejectedValueOnce({ type: "StripeConnectionError", message: "timeout" });
    const first = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(first.ok).toBe(false);
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(persistFoundationRefundOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "UNCERTAIN" })
    );
    const second = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(second.ok).toBe(true);
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
    expect(stripe.refunds.create.mock.calls[1][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
  });

  it("resumes RefundOperation SUCCEEDED without a second Stripe refund or restock duplicate", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    ensureFoundationStorefrontRefundOperation.mockResolvedValue({
      action: "already_succeeded",
      operation: {
        id: "ro_1",
        storeOrderId: "ord-1",
        amountCents: 1000,
        currency: "usd",
        providerIdempotencyKey: "nwc_store_refund_ord-1",
        stripeRefundId: "re_existing",
      },
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null, items: [{ id: "oi-1", storeItemId: "item-1", quantity: 1 }] },
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(result).toEqual({ ok: true, refunded: true, amountCents: 1000 });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "PHYSICAL_RECEIPT",
      "ret-1"
    );
  });

  it("does not restock again when inventoryRestoredAt is already set after SUCCEEDED", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    ensureFoundationStorefrontRefundOperation.mockResolvedValue({
      action: "already_succeeded",
      operation: {
        id: "ro_1",
        storeOrderId: "ord-1",
        amountCents: 1000,
        currency: "usd",
        providerIdempotencyKey: "nwc_store_refund_ord-1",
        stripeRefundId: "re_existing",
      },
    });
    const stripe = stripeStub();
    mockPersistLocalTransaction({
      inventoryRestoredAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: {
        ...paidOrder,
        stripeSellerTransferId: null,
        inventoryRestoredAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(result.ok).toBe(true);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("rejects a second distinct full refund once the order is already refunded", async () => {
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, status: "refunded" },
    });
    expect(result).toEqual({ ok: false, error: "Order already refunded", status: 400 });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(ensureFoundationStorefrontRefundOperation).not.toHaveBeenCalled();
  });

  it("fails closed when a later refund amount conflicts with the durable operation", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    ensureFoundationStorefrontRefundOperation.mockRejectedValue(
      new FoundationRefundIntentConflictError("RefundOperation intent conflict for StoreOrder ord-1")
    );
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
      amountCents: 800,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("restocks every order line exactly once for a multi-item physical return", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    const stripe = stripeStub();
    const items = [
      { id: "oi-a", storeItemId: "item-a", quantity: 1 },
      { id: "oi-b", storeItemId: "item-b", quantity: 2 },
    ];
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null, items },
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(result.ok).toBe(true);
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
    expect(restockOrderLinesAfterReturn.mock.calls[0][1]).toEqual(items);
    expect(restockOrderLinesAfterReturn.mock.calls[0][2]).toBe("PHYSICAL_RECEIPT");
    expect(restockOrderLinesAfterReturn.mock.calls[0][3]).toBe("ret-1");
  });
});

describe("storefront transfer reversal identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_from_op",
    });
    ensureFoundationStorefrontRefundOperation.mockImplementation(async (_db: unknown, args: { storeOrderId: string; amountCents: number }) => ({
      action: "provider_create" as const,
      operation: {
        id: "ro_1",
        storeOrderId: args.storeOrderId,
        amountCents: args.amountCents,
        currency: "usd",
        providerIdempotencyKey: `nwc_store_refund_${args.storeOrderId}`,
        stripeRefundId: null,
      },
    }));
    mockPersistLocalTransaction();
  });

  it("uses a stable StoreOrder-scoped reversal idempotency key", () => {
    expect(storefrontTransferReversalIdempotencyKey("ord-1")).toBe("nwc_store_reversal_ord-1");
    expect(storefrontTransferReversalIdempotencyKey("ord-1")).toBe(storefrontTransferReversalIdempotencyKey("ord-1"));
  });

  it("creates the reversal with transfer id, amount, metadata, and stable key", async () => {
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(true);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_from_op",
      {
        amount: 990,
        metadata: { storeOrderId: "ord-1", refundOperationId: "ro_1" },
      },
      { idempotencyKey: "nwc_store_reversal_ord-1" }
    );
  });

  it("reuses an existing matching reversal and does not create another", async () => {
    const stripe = stripeStub();
    stripe.transfers.listReversals.mockResolvedValue(matchingReversalList({ refundOperationId: "ro_1" }));
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(true);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1", amount: 1000 }),
      { idempotencyKey: "nwc_store_refund_ord-1" }
    );
  });

  it("fails closed when matching reversal metadata has a different amount", async () => {
    const stripe = stripeStub();
    stripe.transfers.listReversals.mockResolvedValue(
      matchingReversalList({ amount: 500, refundOperationId: "ro_1" })
    );
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("does not reverse again after reversal success and refund failure", async () => {
    const stripe = stripeStub();
    stripe.refunds.create.mockRejectedValueOnce({ type: "StripeInvalidRequestError", message: "card_decline", statusCode: 400 });
    const first = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(first.ok).toBe(false);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();

    stripe.transfers.listReversals.mockResolvedValue(matchingReversalList({ refundOperationId: "ro_1" }));
    stripe.refunds.create.mockResolvedValueOnce({ id: "re_2", status: "succeeded", created: 1_700_000_000 });
    const second = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(second.ok).toBe(true);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create.mock.calls[1][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
  });

  it("reconciles a timeout after Stripe created the reversal", async () => {
    const stripe = stripeStub();
    stripe.transfers.createReversal.mockRejectedValueOnce({ type: "StripeConnectionError", message: "timeout" });
    const first = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(first.ok).toBe(false);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();

    stripe.transfers.listReversals.mockResolvedValue(matchingReversalList({ refundOperationId: "ro_1" }));
    const second = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(second.ok).toBe(true);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("retries create with the same reversal key when timeout left no provider reversal", async () => {
    const stripe = stripeStub();
    stripe.transfers.createReversal.mockRejectedValueOnce({ type: "StripeConnectionError", message: "timeout" });
    const first = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(first.ok).toBe(false);
    expect(stripe.refunds.create).not.toHaveBeenCalled();

    const second = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(second.ok).toBe(true);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.createReversal.mock.calls[0][2]).toEqual({ idempotencyKey: "nwc_store_reversal_ord-1" });
    expect(stripe.transfers.createReversal.mock.calls[1][2]).toEqual({ idempotencyKey: "nwc_store_reversal_ord-1" });
    expect(stripe.transfers.createReversal.mock.calls[0][1]).toEqual(stripe.transfers.createReversal.mock.calls[1][1]);
  });

  it("reuses matching provider reversal after the original idempotency key would have expired", async () => {
    const stripe = stripeStub();
    stripe.transfers.listReversals.mockResolvedValue(matchingReversalList({ id: "rev_old", refundOperationId: "ro_1" }));
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(true);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalled();
  });

  it("uses the same reversal key for concurrent refund retries", async () => {
    const stripe = stripeStub();
    const [a, b] = await Promise.all([
      refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder }),
      refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.createReversal.mock.calls[0][2]).toEqual({ idempotencyKey: "nwc_store_reversal_ord-1" });
    expect(stripe.transfers.createReversal.mock.calls[1][2]).toEqual({ idempotencyKey: "nwc_store_reversal_ord-1" });
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
    expect(stripe.refunds.create.mock.calls[1][1]).toEqual({ idempotencyKey: "nwc_store_refund_ord-1" });
  });

  it("skips reversal and refund create when RefundOperation already SUCCEEDED", async () => {
    ensureFoundationStorefrontRefundOperation.mockResolvedValue({
      action: "already_succeeded",
      operation: {
        id: "ro_1",
        storeOrderId: "ord-1",
        amountCents: 1000,
        currency: "usd",
        providerIdempotencyKey: "nwc_store_refund_ord-1",
        stripeRefundId: "re_existing",
      },
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, items: [{ id: "oi-1", storeItemId: "item-1", quantity: 1 }] },
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(result).toEqual({ ok: true, refunded: true, amountCents: 1000 });
    expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
  });

  it("fails refund-intent amount conflict before any reversal provider work", async () => {
    ensureFoundationStorefrontRefundOperation.mockRejectedValue(
      new FoundationRefundIntentConflictError("RefundOperation intent conflict for StoreOrder ord-1")
    );
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: paidOrder,
      amountCents: 800,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("does not refund or restock after a definitive reversal failure", async () => {
    const stripe = stripeStub();
    stripe.transfers.createReversal.mockRejectedValueOnce({
      type: "StripeInvalidRequestError",
      message: "Transfer cannot be reversed",
      statusCode: 400,
    });
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(false);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("does not refund or restock after an uncertain reversal timeout", async () => {
    const stripe = stripeStub();
    stripe.transfers.createReversal.mockRejectedValueOnce({ type: "StripeConnectionError", message: "timeout" });
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("does not look up or create a reversal when payout is locked out", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
    });
    expect(result.ok).toBe(true);
    expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalled();
  });

  it("fails closed on PROCESSING payout before reversal or refund", async () => {
    lockFoundationPayoutOutForRefund.mockRejectedValue(
      new FoundationTransferRefundBlockedError("TRANSFER_IN_FLIGHT", "blocked")
    );
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(ensureFoundationStorefrontRefundOperation).not.toHaveBeenCalled();
    expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("does not claim an unrelated reversal as the causal StoreOrder reversal", async () => {
    const stripe = stripeStub();
    stripe.transfers.listReversals.mockResolvedValue({
      object: "list",
      data: [{ id: "rev_other", amount: 990, metadata: { storeOrderId: "ord-other" } }],
      has_more: false,
    });
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(true);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.createReversal.mock.calls[0][1].metadata).toEqual({
      storeOrderId: "ord-1",
      refundOperationId: "ro_1",
    });
  });

  it("LEGACY seller-transfer refund uses the StoreOrder reversal key and metadata without RefundOperation", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({ stripe: stripe as never, order: paidOrder });
    expect(result.ok).toBe(true);
    expect(ensureFoundationStorefrontRefundOperation).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_1",
      { amount: 990, metadata: { storeOrderId: "ord-1" } },
      { idempotencyKey: "nwc_store_reversal_ord-1" }
    );
    expect(stripe.refunds.create).toHaveBeenCalled();
  });
});

describe("zero-dollar and corrupt refund amounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    mockPersistLocalTransaction();
  });

  it("completes a legitimate $0 return locally without Stripe or RefundOperation", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_from_op",
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, items: [{ id: "oi-1", storeItemId: "item-1", quantity: 1 }] },
      amountCents: 0,
      transferReversalCents: 0,
      ledgerDebitCents: 0,
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(result).toEqual({ ok: true, refunded: true, amountCents: 0 });
    expect(ensureFoundationStorefrontRefundOperation).not.toHaveBeenCalled();
    expect(stripe.transfers.listReversals).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "PHYSICAL_RECEIPT",
      "ret-1"
    );
  });

  it("does not write a seller ledger row when the $0 debit is zero", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_from_op",
    });
    const stripe = stripeStub();
    const state = mockPersistLocalTransaction();
    await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: paidOrder,
      amountCents: 0,
      ledgerDebitCents: 0,
    });
    expect(state.returnLedger).toHaveLength(0);
    expect(state.tx.sellerBalanceTransaction.create).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("marks StoreOrder refunded locally for $0 without manufacturing a Stripe refund id", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({ kind: "LOCKED_OUT", operation: null });
    const stripe = stripeStub();
    const state = mockPersistLocalTransaction();
    await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: paidOrder,
      amountCents: 0,
      ledgerDebitCents: 0,
    });
    const updateData = state.tx.storeOrder.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(updateData).toMatchObject({ status: "refunded" });
    expect(updateData.stripeRefundId).toBeUndefined();
    expect(updateData.refundCompletedAt).toBeInstanceOf(Date);
  });

  it("still restocks a $0 return through PHYSICAL_RECEIPT", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({ kind: "LOCKED_OUT", operation: null });
    const stripe = stripeStub();
    await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, items: [{ id: "oi-1", storeItemId: "item-1", quantity: 1 }] },
      amountCents: 0,
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "PHYSICAL_RECEIPT",
      "ret-1"
    );
  });

  it("does not restock again on a $0 retry after inventoryRestoredAt", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({ kind: "LOCKED_OUT", operation: null });
    const stripe = stripeStub();
    mockPersistLocalTransaction({
      inventoryRestoredAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, inventoryRestoredAt: new Date("2026-09-01T00:00:00.000Z") },
      amountCents: 0,
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("fails closed on PROCESSING even when the computed refund is $0", async () => {
    lockFoundationPayoutOutForRefund.mockRejectedValue(
      new FoundationTransferRefundBlockedError("TRANSFER_IN_FLIGHT", "blocked")
    );
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: paidOrder,
      amountCents: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("fails closed on a corrupt negative amount with zero Stripe and zero restock", async () => {
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: paidOrder,
      amountCents: -1,
    });
    expect(result).toEqual({
      ok: false,
      error: "Refund amount is invalid; operator reconciliation is required.",
      status: 409,
    });
    expect(lockFoundationPayoutOutForRefund).not.toHaveBeenCalled();
    expect(ensureFoundationStorefrontRefundOperation).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps the positive refund path keyed after a $0 policy is present", async () => {
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "TRANSFER_SUCCEEDED",
      stripeTransferId: "tr_from_op",
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
      amountCents: 1000,
    });
    expect(result.ok).toBe(true);
    expect(ensureFoundationStorefrontRefundOperation).toHaveBeenCalled();
    expect(stripe.transfers.createReversal).toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, payment_intent: "pi_1" }),
      { idempotencyKey: "nwc_store_refund_ord-1" }
    );
  });
});

describe("Foundation buyer refund 23h replay gate", () => {
  const buyerOrder = {
    id: "ord-1",
    sellerId: "seller-1",
    totalCents: 1000,
    subtotalCents: 1000,
    taxCents: 0,
    stripePaymentIntentId: "pi_1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    lockFoundationPayoutOutForRefund.mockResolvedValue({
      kind: "LOCKED_OUT",
      operation: { lastError: "order_refunded_before_transfer" },
    });
    mockPersistLocalTransaction();
  });

  it("does not call Stripe when executeStorefrontBuyerRefund sees replay_window_expired", async () => {
    ensureFoundationStorefrontRefundOperation.mockResolvedValue({
      action: "replay_window_expired",
      operation: {
        id: "ro_1",
        storeOrderId: "ord-1",
        retryCount: 2,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        providerIdempotencyKey: "nwc_store_refund_ord-1",
        stripeRefundId: null,
      },
    });
    const stripe = stripeStub();
    const result = await executeStorefrontBuyerRefund({
      stripe: stripe as never,
      order: buyerOrder,
      amountCents: 1000,
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
      now: new Date("2026-01-02T01:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "replay_window_expired",
      error: "Buyer refund replay window expired; operator recovery is required.",
      httpStatus: 409,
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(persistFoundationRefundOutcome).not.toHaveBeenCalled();
  });

  it("seller Retry via refundPaidStorefrontOrder inherits the same 23h block", async () => {
    ensureFoundationStorefrontRefundOperation.mockResolvedValue({
      action: "replay_window_expired",
      operation: {
        id: "ro_1",
        storeOrderId: "ord-1",
        retryCount: 2,
        providerIdempotencyKey: "nwc_store_refund_ord-1",
        stripeRefundId: null,
      },
    });
    const stripe = stripeStub();
    const result = await refundPaidStorefrontOrder({
      stripe: stripe as never,
      order: { ...paidOrder, stripeSellerTransferId: null },
      restock: true,
      restockOperationId: "ret-1",
      restockKind: "PHYSICAL_RECEIPT",
    });
    expect(result).toEqual({
      ok: false,
      error: "Buyer refund replay window expired; operator recovery is required.",
      status: 409,
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("does not mint another refund when SUCCEEDED is missing stripeRefundId", async () => {
    ensureFoundationStorefrontRefundOperation.mockResolvedValue({
      action: "operator_required",
      reason: "succeeded_without_stripe_refund_id",
      operation: {
        id: "ro_1",
        storeOrderId: "ord-1",
        status: "SUCCEEDED",
        stripeRefundId: null,
        providerIdempotencyKey: "nwc_store_refund_ord-1",
      },
    });
    const stripe = stripeStub();
    const result = await executeStorefrontBuyerRefund({
      stripe: stripe as never,
      order: buyerOrder,
      amountCents: 1000,
    });
    expect(result.status).toBe("conflict");
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("skips the 23h gate for zero-dollar refunds", async () => {
    const stripe = stripeStub();
    const result = await executeStorefrontBuyerRefund({
      stripe: stripe as never,
      order: buyerOrder,
      amountCents: 0,
    });
    expect(result).toEqual({
      status: "zero_amount",
      amountCents: 0,
      stripeRefund: null,
      alreadySucceeded: false,
    });
    expect(ensureFoundationStorefrontRefundOperation).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
});

describe("persistLocalStorefrontRefundCompletion concurrent ledger evidence", () => {
  const completion = {
    order: paidOrder,
    restock: true,
    restockKind: "PHYSICAL_RECEIPT" as const,
    restockOperationId: "ret-1",
    ledgerDebitCents: 990,
    skipSellerLedgerDebit: false,
    stripeRefund: { id: "re_1", status: "succeeded" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("debits seller ledger and restocks exactly once under concurrent Path-A completion", async () => {
    const state = persistLocalTxState();
    let chain = Promise.resolve();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const run = chain.then(() => fn(state.tx));
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    });

    await Promise.all([
      persistLocalStorefrontRefundCompletion(completion),
      persistLocalStorefrontRefundCompletion(completion),
    ]);

    expect(state.returnLedger.filter((row) => row.type === "return")).toHaveLength(1);
    expect(state.returnLedger[0]).toMatchObject({
      memberId: "seller-1",
      orderId: "ord-1",
      type: "return",
      amountCents: -990,
    });
    expect(state.tx.sellerBalance.upsert).toHaveBeenCalledTimes(1);
    expect(state.getBalance()).toBe(-990);
    expect(restockOrderLinesAfterReturn).toHaveBeenCalledTimes(1);
    expect(state.orderRow.status).toBe("refunded");
    expect(state.tx.$executeRaw).toHaveBeenCalled();
    expect(state.tx.storeOrder.findUnique).toHaveBeenCalled();
  });

  it("creates a missing Path-A return debit even when StoreOrder is already refunded", async () => {
    const state = mockPersistLocalTransaction({
      status: "refunded",
      inventoryRestoredAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await persistLocalStorefrontRefundCompletion(completion);
    expect(state.returnLedger).toHaveLength(1);
    expect(state.returnLedger[0]).toMatchObject({ type: "return", amountCents: -990, memberId: "seller-1" });
    expect(state.tx.sellerBalance.upsert).toHaveBeenCalledTimes(1);
    expect(state.getBalance()).toBe(-990);
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).toHaveBeenCalled();
  });

  it("does not duplicate an exact existing Path-A return debit on a refunded order", async () => {
    const state = mockPersistLocalTransaction({
      status: "refunded",
      inventoryRestoredAt: new Date("2026-09-01T00:00:00.000Z"),
      existingReturnLedger: {
        memberId: "seller-1",
        amountCents: -990,
        orderId: "ord-1",
        type: "return",
      },
    });
    await persistLocalStorefrontRefundCompletion(completion);
    expect(state.returnLedger).toHaveLength(1);
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.tx.sellerBalanceTransaction.create).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).toHaveBeenCalled();
  });

  it("fails closed on conflicting return ledger evidence without mutating balance or order", async () => {
    const state = mockPersistLocalTransaction({
      status: "refunded",
      existingReturnLedger: {
        memberId: "seller-1",
        amountCents: -500,
        orderId: "ord-1",
        type: "return",
      },
    });
    await expect(persistLocalStorefrontRefundCompletion(completion)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.tx.sellerBalanceTransaction.create).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
    expect(state.orderRow.status).toBe("refunded");
    expect(state.getBalance()).toBe(0);
  });

  it("fails closed when an existing return debit belongs to the wrong seller", async () => {
    const state = mockPersistLocalTransaction({
      existingReturnLedger: {
        memberId: "other-seller",
        amountCents: -990,
        orderId: "ord-1",
        type: "return",
      },
    });
    await expect(persistLocalStorefrontRefundCompletion(completion)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).not.toHaveBeenCalled();
  });

  it("does not write a zero-dollar Path-A ledger row", async () => {
    const state = mockPersistLocalTransaction();
    await persistLocalStorefrontRefundCompletion({
      ...completion,
      ledgerDebitCents: 0,
    });
    expect(state.tx.sellerBalanceTransaction.findMany).toHaveBeenCalled();
    expect(state.tx.sellerBalanceTransaction.create).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).toHaveBeenCalled();
  });

  it("does not debit Path B/C when skipSellerLedgerDebit is set, even if the order is refunded", async () => {
    const state = mockPersistLocalTransaction({ status: "refunded" });
    await persistLocalStorefrontRefundCompletion({
      ...completion,
      skipSellerLedgerDebit: true,
    });
    expect(state.tx.sellerBalanceTransaction.findMany).toHaveBeenCalled();
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.returnLedger).toHaveLength(0);
  });

  it("fails closed on duplicate exact Path-A return rows without mutating balance", async () => {
    const state = mockPersistLocalTransaction({
      existingReturnLedger: [
        { id: "a", memberId: "seller-1", amountCents: -990, orderId: "ord-1", type: "return" },
        { id: "b", memberId: "seller-1", amountCents: -990, orderId: "ord-1", type: "return" },
      ],
    });
    await expect(persistLocalStorefrontRefundCompletion(completion)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.tx.sellerBalanceTransaction.create).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).not.toHaveBeenCalled();
    expect(restockOrderLinesAfterReturn).not.toHaveBeenCalled();
  });

  it("fails closed on exact-plus-conflict Path-A return rows", async () => {
    const state = mockPersistLocalTransaction({
      existingReturnLedger: [
        { id: "a", memberId: "seller-1", amountCents: -990, orderId: "ord-1", type: "return" },
        { id: "b", memberId: "seller-1", amountCents: -500, orderId: "ord-1", type: "return" },
      ],
    });
    await expect(persistLocalStorefrontRefundCompletion(completion)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).not.toHaveBeenCalled();
  });

  it("fails closed when Path-A expects none but a stray return row exists", async () => {
    const state = mockPersistLocalTransaction({
      existingReturnLedger: {
        id: "stray",
        memberId: "seller-1",
        amountCents: -990,
        orderId: "ord-1",
        type: "return",
      },
    });
    await expect(
      persistLocalStorefrontRefundCompletion({
        ...completion,
        ledgerDebitCents: 0,
      })
    ).rejects.toBeInstanceOf(StorefrontReturnLedgerConflictError);
    expect(state.tx.sellerBalance.upsert).not.toHaveBeenCalled();
    expect(state.tx.storeOrder.update).not.toHaveBeenCalled();
  });
});
