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
    CommerceFoundationCutoverBlockedError,
    FoundationTransferRefundBlockedError,
    FoundationRefundIntentConflictError,
  };
});

vi.mock("database", () => ({
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
}));

vi.mock("@/lib/store-item-restock", () => ({
  restockOrderLinesAfterReturn,
}));

import { refundPaidStorefrontOrder, restockAfterExternalRefund } from "./refund-store-order";

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

function stripeStub() {
  return {
    transfers: {
      createReversal: vi.fn().mockResolvedValue({ id: "rev_1" }),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_1", status: "succeeded", created: 1_700_000_000 }),
      list: vi.fn(),
    },
  };
}

describe("restockAfterExternalRefund cutover ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.storeOrder.findUnique.mockResolvedValue(paidOrder);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        storeOrder: { update: vi.fn().mockResolvedValue({}) },
        sellerBalance: { upsert: vi.fn().mockResolvedValue({}) },
        sellerBalanceTransaction: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
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

    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_1");
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
});

describe("courtesy refund restock:false remains ungated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        storeOrder: { update: vi.fn().mockResolvedValue({}) },
        sellerBalance: { upsert: vi.fn().mockResolvedValue({}) },
        sellerBalanceTransaction: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
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
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        storeOrder: { update: vi.fn().mockResolvedValue({}) },
        sellerBalance: { upsert: vi.fn().mockResolvedValue({}) },
        sellerBalanceTransaction: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
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
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_from_op");
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
});
