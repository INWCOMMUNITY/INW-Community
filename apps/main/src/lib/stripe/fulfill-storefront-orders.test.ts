import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  assertLegacyDrainFinalizerAllowed,
  applyStoreItemDecrementAfterSale,
  getCommerceFoundationCutoverState,
  finalizeFoundationCheckoutPayment,
  ensureFoundationTransferIntents,
  beginFoundationTransferAttempt,
  persistFoundationTransferSuccess,
  persistFoundationTransferOutcome,
  completeFoundationSellerPayoutLedger,
  markFoundationStoreOrderPaidAfterConvert,
  markFoundationAttemptUnfulfillable,
  foundationSellerPayoutRecoveryWhere,
  CommerceFoundationCutoverBlockedError,
  FoundationCheckoutNotConvertibleError,
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
  class FoundationCheckoutNotConvertibleError extends Error {
    code = "reservation_not_convertible";
    constructor(message = "not convertible") {
      super(message);
      this.name = "FoundationCheckoutNotConvertibleError";
    }
  }
  return {
    mockPrisma: {
      storeOrder: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      storeItem: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      member: { findMany: vi.fn() },
      sellerBalance: { upsert: vi.fn() },
      sellerBalanceTransaction: { create: vi.fn() },
      cartItem: { findMany: vi.fn(), deleteMany: vi.fn() },
      orderItem: { findMany: vi.fn() },
      resaleOffer: { updateMany: vi.fn() },
      transferOperation: { findUnique: vi.fn() },
    },
    assertLegacyDrainFinalizerAllowed: vi.fn(async () => {}),
    applyStoreItemDecrementAfterSale: vi.fn(async () => {}),
    getCommerceFoundationCutoverState: vi.fn(async () => ({ mode: "LEGACY" })),
    finalizeFoundationCheckoutPayment: vi.fn(async () => ({
      converted: 1,
      alreadyFinalized: false,
      attemptId: "att_1",
    })),
    ensureFoundationTransferIntents: vi.fn(async () => []),
    beginFoundationTransferAttempt: vi.fn(async (_db: unknown, args: { storeOrderId: string }) => ({
      action: "provider_create" as const,
      operation: {
        id: `top_${args.storeOrderId}`,
        storeOrderId: args.storeOrderId,
        providerIdempotencyKey: `nwc_store_transfer_${args.storeOrderId}`,
        amountCents: 990,
        currency: "usd",
      },
    })),
    persistFoundationTransferSuccess: vi.fn(async () => ({})),
    persistFoundationTransferOutcome: vi.fn(async () => ({})),
    completeFoundationSellerPayoutLedger: vi.fn(async () => ({ ledgerCreated: true })),
    markFoundationStoreOrderPaidAfterConvert: vi.fn(async () => ({ paid: true })),
    markFoundationAttemptUnfulfillable: vi.fn(async () => {}),
    foundationSellerPayoutRecoveryWhere: () => ({
      OR: [
        { status: "pending" },
        {
          commerceStatus: "FINALIZED",
          status: { in: ["paid", "shipped", "delivered"] },
          transferOperation: { status: { in: ["PENDING", "PROCESSING", "UNCERTAIN"] } },
        },
        {
          commerceStatus: "FINALIZED",
          status: { in: ["paid", "shipped", "delivered"] },
          transferOperation: { status: "SUCCEEDED", stripeTransferId: { not: null } },
        },
      ],
    }),
    CommerceFoundationCutoverBlockedError,
    FoundationCheckoutNotConvertibleError,
  };
});

vi.mock("database", () => ({
  prisma: mockPrisma,
  assertLegacyDrainFinalizerAllowed,
  CommerceFoundationCutoverBlockedError,
  getCommerceFoundationCutoverState,
  commerceInventoryWriterRoute: (mode: string) =>
    mode === "LEGACY" ? "legacy" : mode === "FOUNDATION" || mode === "UNFROZEN" ? "foundation" : "blocked",
  finalizeFoundationCheckoutPayment,
  ensureFoundationTransferIntents,
  beginFoundationTransferAttempt,
  persistFoundationTransferSuccess,
  persistFoundationTransferOutcome,
  completeFoundationSellerPayoutLedger,
  markFoundationStoreOrderPaidAfterConvert,
  markFoundationAttemptUnfulfillable,
  foundationSellerPayoutRecoveryWhere,
  isPermanentFoundationNonconvertibleError: (err: unknown) =>
    err instanceof FoundationCheckoutNotConvertibleError ||
    (err instanceof Error && err.name === "FoundationCheckoutNotConvertibleError"),
  isRetryableFoundationCommerceError: () => false,
  classifyStripeTransferFailure: (err: unknown) =>
    err && typeof err === "object" && (err as { uncertain?: boolean }).uncertain ? "uncertain" : "failed",
}));

vi.mock("@/lib/store-item-inventory-sale", () => ({
  applyStoreItemDecrementAfterSale,
}));

vi.mock("@/lib/send-push-notification", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/delete-posts-for-sold-item", () => ({
  deleteFeedPostsForSoldItem: vi.fn(),
}));

vi.mock("@/lib/post-sale-inventory-cleanup", () => ({
  cancelPendingOrdersForSoldOutItems: vi.fn(async () => {}),
  cleanupOtherBuyersCartsForStoreItems: vi.fn(async () => {}),
  validateBatchStoreOrdersInventory: vi.fn(() => ({ ok: true, titles: [] })),
}));

import { fulfillStoreOrdersFromCheckoutSession } from "./fulfill-storefront-orders";

const preFreezeCreatedAt = new Date("2026-01-01T00:00:00.000Z");
const postFreezeCreatedAt = new Date("2026-09-18T20:00:00.000Z");

function pendingOrder(overrides: {
  id: string;
  createdAt: Date;
  sellerId?: string;
  checkoutAttemptId?: string | null;
}) {
  return {
    id: overrides.id,
    status: "pending",
    buyerId: "buyer-1",
    sellerId: overrides.sellerId ?? "seller-1",
    totalCents: 1000,
    subtotalCents: 1000,
    createdAt: overrides.createdAt,
    checkoutAttemptId: overrides.checkoutAttemptId ?? null,
    shippingAddress: { street: "1 Main", city: "Spokane", state: "WA", zip: "99201" },
    items: [
      {
        storeItemId: "item-1",
        quantity: 1,
        variant: null,
        fulfillmentType: "pickup",
      },
    ],
  };
}

function paidSession(orderIds: string, amountSubtotal: number) {
  return {
    id: "cs_test",
    mode: "payment" as const,
    payment_status: "paid" as const,
    payment_intent: "pi_test",
    amount_subtotal: amountSubtotal,
    total_details: { amount_tax: 0 },
    metadata: { orderIds },
  };
}

function stripeStub() {
  return {
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({ latest_charge: "ch_test" }),
    },
    transfers: {
      create: vi.fn().mockResolvedValue({ id: "tr_test" }),
      createReversal: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
  };
}

describe("fulfillStoreOrdersFromCheckoutSession cutover ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    finalizeFoundationCheckoutPayment.mockResolvedValue({
      converted: 0,
      alreadyFinalized: true,
      attemptId: "att_1",
    });
    mockPrisma.storeItem.findMany.mockResolvedValue([
      { id: "item-1", title: "Widget", variants: null, quantity: 4, inventoryTracking: "tracked" },
    ]);
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      id: "item-1",
      title: "Widget",
      variants: null,
      quantity: 3,
      inventoryTracking: "tracked",
    });
    mockPrisma.member.findMany.mockResolvedValue([
      { id: "seller-1", stripeConnectAccountId: "acct_1" },
      { id: "seller-2", stripeConnectAccountId: "acct_2" },
    ]);
    mockPrisma.storeOrder.update.mockResolvedValue({});
    mockPrisma.sellerBalance.upsert.mockResolvedValue({});
    mockPrisma.sellerBalanceTransaction.create.mockResolvedValue({});
    mockPrisma.cartItem.findMany.mockResolvedValue([]);
    mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.orderItem.findMany.mockResolvedValue([]);
    mockPrisma.transferOperation.findUnique.mockResolvedValue({
      status: "PENDING",
      retryCount: 0,
      stripeTransferId: null,
    });
  });

  it("FROZEN post-freeze order does not create Connect transfers or decrement inventory", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-post", createdAt: postFreezeCreatedAt })
    );
    assertLegacyDrainFinalizerAllowed.mockRejectedValue(new CommerceFoundationCutoverBlockedError());
    const stripe = stripeStub();

    await expect(
      fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-post", 1000) as never)
    ).rejects.toMatchObject({ code: "inventory_cutover_frozen", retryable: true, httpStatus: 503 });

    expect(assertLegacyDrainFinalizerAllowed).toHaveBeenCalledWith(
      expect.anything(),
      postFreezeCreatedAt
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(applyStoreItemDecrementAfterSale).not.toHaveBeenCalled();
    expect(mockPrisma.storeOrder.update).not.toHaveBeenCalled();
    expect(mockPrisma.storeOrder.updateMany).not.toHaveBeenCalled();
  });

  it("FROZEN pre-freeze order asserts drain before creating a Connect transfer", async () => {
    const callOrder: string[] = [];
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-pre", createdAt: preFreezeCreatedAt })
    );
    assertLegacyDrainFinalizerAllowed.mockImplementation(async () => {
      callOrder.push("assert");
    });
    const stripe = stripeStub();
    stripe.transfers.create.mockImplementation(async () => {
      callOrder.push("transfer");
      return { id: "tr_test" };
    });

    await fulfillStoreOrdersFromCheckoutSession(
      stripe as never,
      paidSession("ord-pre", 1000) as never
    );

    expect(assertLegacyDrainFinalizerAllowed).toHaveBeenCalledWith(
      expect.anything(),
      preFreezeCreatedAt
    );
    expect(stripe.transfers.create).toHaveBeenCalled();
    expect(callOrder.indexOf("assert")).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf("transfer")).toBeGreaterThan(callOrder.indexOf("assert"));
    expect(applyStoreItemDecrementAfterSale).toHaveBeenCalled();
  });

  it("rejects the whole batch before any transfer when one order fails drain", async () => {
    mockPrisma.storeOrder.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "ord-pre") return pendingOrder({ id: "ord-pre", createdAt: preFreezeCreatedAt });
      if (where.id === "ord-post") {
        return pendingOrder({ id: "ord-post", createdAt: postFreezeCreatedAt, sellerId: "seller-2" });
      }
      return null;
    });
    assertLegacyDrainFinalizerAllowed.mockImplementation(async (_db, startedAt: Date) => {
      if (startedAt.getTime() >= postFreezeCreatedAt.getTime()) {
        throw new CommerceFoundationCutoverBlockedError();
      }
    });
    const stripe = stripeStub();

    await expect(
      fulfillStoreOrdersFromCheckoutSession(
        stripe as never,
        paidSession("ord-pre,ord-post", 2000) as never
      )
    ).rejects.toMatchObject({ code: "inventory_cutover_frozen", retryable: true });

    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(applyStoreItemDecrementAfterSale).not.toHaveBeenCalled();
    expect(mockPrisma.storeOrder.update).not.toHaveBeenCalled();
  });

  it("FOUNDATION keeps pending orders for Connect transfer and does not mark sold_out from quantity 0", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      id: "item-1",
      title: "Widget",
      variants: null,
      quantity: 0,
      inventoryTracking: "tracked",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(finalizeFoundationCheckoutPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attemptId: "att_1" })
    );
    expect(applyStoreItemDecrementAfterSale).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-f" })
    );
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-f" })
    );
  });

  it("forwards checkout.session.completed event.id to finalize for StripeEventEvidence", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      id: "item-1",
      title: "Widget",
      variants: null,
      quantity: 1,
      inventoryTracking: "tracked",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never, {
      stripeEventId: "evt_1UJ2uwBGz6ld2lSCEtxJingy",
      eventType: "checkout.session.completed",
    });
    expect(finalizeFoundationCheckoutPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: "att_1",
        stripeEventId: "evt_1UJ2uwBGz6ld2lSCEtxJingy",
        eventType: "checkout.session.completed",
      })
    );
  });

  it("already-paid early path still forwards event id so replay records evidence", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    mockPrisma.storeOrder.findFirst.mockResolvedValue(null);
    mockPrisma.storeOrder.findMany.mockResolvedValue([
      {
        id: "ord-f",
        status: "paid",
        checkoutAttemptId: "att_1",
        items: [{ storeItemId: "item-1" }],
      },
    ]);
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never, {
      stripeEventId: "evt_replay_same",
      eventType: "checkout.session.completed",
    });
    expect(finalizeFoundationCheckoutPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: "att_1",
        stripeEventId: "evt_replay_same",
        eventType: "checkout.session.completed",
      })
    );
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("FOUNDATION TransferOperation orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    finalizeFoundationCheckoutPayment.mockResolvedValue({
      converted: 1,
      alreadyFinalized: false,
      attemptId: "att_1",
    });
    mockPrisma.member.findMany.mockResolvedValue([
      { id: "seller-1", stripeConnectAccountId: "acct_1" },
      { id: "seller-2", stripeConnectAccountId: "acct_2" },
    ]);
    mockPrisma.cartItem.findMany.mockResolvedValue([]);
    mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });
    persistFoundationTransferSuccess.mockResolvedValue({});
    persistFoundationTransferOutcome.mockResolvedValue({});
    completeFoundationSellerPayoutLedger.mockResolvedValue({ ledgerCreated: true });
    markFoundationStoreOrderPaidAfterConvert.mockResolvedValue({ paid: true });
    mockPrisma.transferOperation.findUnique.mockResolvedValue({
      status: "PENDING",
      retryCount: 0,
      stripeTransferId: null,
    });
    beginFoundationTransferAttempt.mockImplementation(async (_db: unknown, args: { storeOrderId: string }) => ({
      action: "provider_create" as const,
      operation: {
        id: `top_${args.storeOrderId}`,
        storeOrderId: args.storeOrderId,
        providerIdempotencyKey: `nwc_store_transfer_${args.storeOrderId}`,
        amountCents: 990,
        currency: "usd",
      },
    }));
  });

  it("finalizes commerce before the first Stripe transfer", async () => {
    const callOrder: string[] = [];
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    finalizeFoundationCheckoutPayment.mockImplementation(async () => {
      callOrder.push("finalize");
      return { converted: 1, alreadyFinalized: false, attemptId: "att_1" };
    });
    const stripe = stripeStub();
    stripe.transfers.create.mockImplementation(async () => {
      callOrder.push("transfer");
      return { id: "tr_test" };
    });
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(ensureFoundationTransferIntents).toHaveBeenCalled();
    expect(callOrder).toEqual(["finalize", "transfer"]);
    expect(callOrder.indexOf("finalize")).toBeLessThan(callOrder.indexOf("transfer"));
  });

  it("permanent CONVERT failure does not transfer, refund, or restock", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    finalizeFoundationCheckoutPayment.mockRejectedValue(new FoundationCheckoutNotConvertibleError("released"));
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(markFoundationAttemptUnfulfillable).toHaveBeenCalledWith(expect.anything(), "att_1");
    expect(markFoundationStoreOrderPaidAfterConvert).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).not.toHaveBeenCalled();
    expect(applyStoreItemDecrementAfterSale).not.toHaveBeenCalled();
  });

  it("multi-seller one bad reservation yields zero transfers for both sellers", async () => {
    mockPrisma.storeOrder.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "ord-a") {
        return pendingOrder({ id: "ord-a", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" });
      }
      return pendingOrder({
        id: "ord-b",
        createdAt: preFreezeCreatedAt,
        sellerId: "seller-2",
        checkoutAttemptId: "att_1",
      });
    });
    finalizeFoundationCheckoutPayment.mockRejectedValue(new FoundationCheckoutNotConvertibleError("missing"));
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-a,ord-b", 2000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(markFoundationAttemptUnfulfillable).toHaveBeenCalled();
  });

  it("CONVERT success then transfer success completes paid and ledger once", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(ensureFoundationTransferIntents).toHaveBeenCalled();
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({
      idempotencyKey: "nwc_store_transfer_ord-f",
    });
    expect(persistFoundationTransferSuccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-f", stripeTransferId: "tr_test" })
    );
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalledTimes(1);
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("definitive transfer failure after CONVERT does not refund or reverse", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    const stripe = stripeStub();
    stripe.transfers.create.mockRejectedValue({
      type: "StripeInvalidRequestError",
      statusCode: 400,
      message: "No such destination",
    });
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(finalizeFoundationCheckoutPayment).toHaveBeenCalled();
    expect(persistFoundationTransferOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-f", status: "FAILED" })
    );
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalledTimes(1);
    expect(completeFoundationSellerPayoutLedger).not.toHaveBeenCalled();
    expect(applyStoreItemDecrementAfterSale).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
  });

  it("uncertain transfer persists UNCERTAIN without a second key", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    const stripe = stripeStub();
    stripe.transfers.create.mockRejectedValue({ uncertain: true, message: "timeout" });
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(persistFoundationTransferOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "UNCERTAIN" })
    );
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1].idempotencyKey).toBe("nwc_store_transfer_ord-f");
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalledTimes(1);
    expect(completeFoundationSellerPayoutLedger).not.toHaveBeenCalled();
  });

  it("operator-required UNCERTAIN does not call Stripe create", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "operator_required",
      operation: { id: "top_1", lastAttemptAt: new Date(0) },
      reason: "uncertain_replay_window_elapsed",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("UNCERTAIN replay within the 23h window reuses the same provider key", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "provider_create",
      operation: {
        id: "top_ord-f",
        storeOrderId: "ord-f",
        providerIdempotencyKey: "nwc_store_transfer_ord-f",
        amountCents: 990,
        currency: "usd",
      },
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1].idempotencyKey).toBe("nwc_store_transfer_ord-f");
  });

  it("crash after Stripe success leaves UNCERTAIN not FAILED", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    persistFoundationTransferSuccess.mockRejectedValue(new Error("db down"));
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(persistFoundationTransferOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "UNCERTAIN" })
    );
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("already SUCCEEDED repairs paid/ledger without another Stripe call", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "already_succeeded",
      operation: { id: "top_1", stripeTransferId: "tr_existing", status: "SUCCEEDED" },
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(1);
  });

  it("SUCCEEDED without Stripe transfer ID fails closed with no provider create", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "operator_required",
      operation: { id: "top_1", status: "SUCCEEDED", stripeTransferId: null },
      reason: "succeeded_without_stripe_transfer_id",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).not.toHaveBeenCalled();
  });

  it("duplicate fulfillment uses the same idempotency key once CONVERT has succeeded", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    beginFoundationTransferAttempt
      .mockResolvedValueOnce({
        action: "provider_create" as const,
        operation: {
          id: "top_ord-f",
          storeOrderId: "ord-f",
          providerIdempotencyKey: "nwc_store_transfer_ord-f",
          amountCents: 990,
          currency: "usd",
        },
      })
      .mockResolvedValueOnce({
        action: "already_succeeded" as const,
        operation: { id: "top_ord-f", stripeTransferId: "tr_test", status: "SUCCEEDED" },
      });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1].idempotencyKey).toBe("nwc_store_transfer_ord-f");
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(2);
  });

  it("concurrent webhook and reconciler fulfillment share one durable provider key", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    const stripe = stripeStub();
    await Promise.all([
      fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never),
      fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never),
    ]);
    expect(stripe.transfers.create.mock.calls.length).toBeGreaterThan(0);
    expect(
      stripe.transfers.create.mock.calls.every((call) => call[1].idempotencyKey === "nwc_store_transfer_ord-f")
    ).toBe(true);
  });

  it("already UNFULFILLABLE orders do not CONVERT or transfer again", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
      commerceStatus: "UNFULFILLABLE",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(finalizeFoundationCheckoutPayment).not.toHaveBeenCalled();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(ensureFoundationTransferIntents).not.toHaveBeenCalled();
  });

  it("marks StoreOrder paid after CONVERT before the seller transfer result", async () => {
    const callOrder: string[] = [];
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    markFoundationStoreOrderPaidAfterConvert.mockImplementation(async () => {
      callOrder.push("paid");
      return { paid: true };
    });
    const stripe = stripeStub();
    stripe.transfers.create.mockImplementation(async () => {
      callOrder.push("transfer");
      return { id: "tr_test" };
    });
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(callOrder).toEqual(["paid", "transfer"]);
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalled();
  });

  it("selects paid/shipped/delivered FINALIZED Foundation orders for payout recovery", async () => {
    mockPrisma.storeOrder.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      expect(where).toEqual(
        expect.objectContaining({
          id: "ord-f",
          OR: [
            { status: "pending" },
            {
              commerceStatus: "FINALIZED",
              status: { in: ["paid", "shipped", "delivered"] },
              transferOperation: { status: { in: ["PENDING", "PROCESSING", "UNCERTAIN"] } },
            },
            {
              commerceStatus: "FINALIZED",
              status: { in: ["paid", "shipped", "delivered"] },
              transferOperation: { status: "SUCCEEDED", stripeTransferId: { not: null } },
            },
          ],
        })
      );
      return {
        ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
        status: "shipped",
        commerceStatus: "FINALIZED",
      };
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("missing Connect before provider call persists FAILED without incrementing through begin", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" })
    );
    mockPrisma.member.findMany.mockResolvedValue([{ id: "seller-1", stripeConnectAccountId: null }]);
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(beginFoundationTransferAttempt).not.toHaveBeenCalled();
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(persistFoundationTransferOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "FAILED", lastError: "missing_connect_account" })
    );
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalled();
  });

  it("multi-seller CONVERT then partial payout keeps both sales paid", async () => {
    mockPrisma.storeOrder.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "ord-a") {
        return pendingOrder({ id: "ord-a", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" });
      }
      return pendingOrder({
        id: "ord-b",
        createdAt: preFreezeCreatedAt,
        sellerId: "seller-2",
        checkoutAttemptId: "att_1",
      });
    });
    const stripe = stripeStub();
    stripe.transfers.create
      .mockResolvedValueOnce({ id: "tr_a" })
      .mockRejectedValueOnce({ type: "StripeInvalidRequestError", message: "No such destination", statusCode: 400 });
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-a,ord-b", 2000) as never);
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalledTimes(2);
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(1);
    expect(persistFoundationTransferOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-b", status: "FAILED" })
    );
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("pays a shipped PENDING TransferOperation without regressing lifecycle status", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
      status: "shipped",
      commerceStatus: "FINALIZED",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(markFoundationStoreOrderPaidAfterConvert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-f" })
    );
    expect(persistFoundationTransferSuccess).toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalled();
    expect(mockPrisma.storeOrder.update).not.toHaveBeenCalled();
  });

  it("repairs SUCCEEDED projection/ledger after shipping without a provider call", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
      status: "shipped",
      commerceStatus: "FINALIZED",
      stripeSellerTransferId: null,
    });
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "already_succeeded",
      operation: {
        id: "top_ord-f",
        storeOrderId: "ord-f",
        providerIdempotencyKey: "nwc_store_transfer_ord-f",
        amountCents: 990,
        currency: "usd",
        stripeTransferId: "tr_existing",
      },
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(1);
    expect(mockPrisma.storeOrder.update).not.toHaveBeenCalled();
  });

  it("multi-seller shipped recovery pays only the unresolved seller", async () => {
    mockPrisma.storeOrder.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...pendingOrder({
        id: where.id,
        createdAt: preFreezeCreatedAt,
        sellerId: where.id === "ord-a" ? "seller-1" : "seller-2",
        checkoutAttemptId: "att_1",
      }),
      status: "shipped",
      commerceStatus: "FINALIZED",
    }));
    beginFoundationTransferAttempt.mockImplementation(async (_db: unknown, args: { storeOrderId: string }) => {
      if (args.storeOrderId === "ord-a") {
        return {
          action: "already_succeeded" as const,
          operation: {
            id: "top_a",
            storeOrderId: "ord-a",
            providerIdempotencyKey: "nwc_store_transfer_ord-a",
            amountCents: 990,
            currency: "usd",
            stripeTransferId: "tr_a",
          },
        };
      }
      return {
        action: "provider_create" as const,
        operation: {
          id: "top_b",
          storeOrderId: "ord-b",
          providerIdempotencyKey: "nwc_store_transfer_ord-b",
          amountCents: 990,
          currency: "usd",
        },
      };
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-a,ord-b", 2000) as never);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: "nwc_store_transfer_ord-b" });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(2);
  });

  it("repairs SUCCEEDED ledger when compatibility ID is already set without a provider call", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
      status: "paid",
      commerceStatus: "FINALIZED",
      stripeSellerTransferId: "tr_123",
    });
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "already_succeeded",
      operation: {
        id: "top_ord-f",
        storeOrderId: "ord-f",
        providerIdempotencyKey: "nwc_store_transfer_ord-f",
        amountCents: 990,
        currency: "usd",
        stripeTransferId: "tr_123",
        status: "SUCCEEDED",
      },
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(1);
    expect(mockPrisma.storeOrder.update).not.toHaveBeenCalled();
  });

  it("repairs SUCCEEDED ledger after delivery without a provider call", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
      status: "delivered",
      commerceStatus: "FINALIZED",
      stripeSellerTransferId: "tr_123",
    });
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "already_succeeded",
      operation: {
        id: "top_ord-f",
        storeOrderId: "ord-f",
        providerIdempotencyKey: "nwc_store_transfer_ord-f",
        amountCents: 990,
        currency: "usd",
        stripeTransferId: "tr_123",
        status: "SUCCEEDED",
      },
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).toHaveBeenCalledTimes(1);
    expect(mockPrisma.storeOrder.update).not.toHaveBeenCalled();
  });

  it("fails closed on conflicting compatibility transfer ID without a provider call", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...pendingOrder({ id: "ord-f", createdAt: preFreezeCreatedAt, checkoutAttemptId: "att_1" }),
      status: "paid",
      commerceStatus: "FINALIZED",
      stripeSellerTransferId: "tr_B",
    });
    beginFoundationTransferAttempt.mockResolvedValue({
      action: "operator_required",
      operation: {
        id: "top_ord-f",
        stripeTransferId: "tr_A",
        status: "SUCCEEDED",
      },
      reason: "compatibility_transfer_id_conflict",
    });
    const stripe = stripeStub();
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-f", 1000) as never);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerPayoutLedger).not.toHaveBeenCalled();
  });

  it("LEGACY still refunds and reverses on transfer failure and does not write TransferOperations", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    mockPrisma.storeOrder.findFirst.mockResolvedValue(
      pendingOrder({ id: "ord-l", createdAt: preFreezeCreatedAt })
    );
    mockPrisma.storeItem.findMany.mockResolvedValue([
      { id: "item-1", title: "Widget", variants: null, quantity: 4, inventoryTracking: "tracked" },
    ]);
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      id: "item-1",
      title: "Widget",
      variants: null,
      quantity: 3,
      inventoryTracking: "tracked",
    });
    const stripe = stripeStub();
    stripe.transfers.create.mockRejectedValue(new Error("connect down"));
    await fulfillStoreOrdersFromCheckoutSession(stripe as never, paidSession("ord-l", 1000) as never);
    expect(ensureFoundationTransferIntents).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalled();
    expect(mockPrisma.storeOrder.updateMany).toHaveBeenCalled();
  });
});
