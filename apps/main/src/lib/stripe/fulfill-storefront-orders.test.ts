import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  assertLegacyDrainFinalizerAllowed,
  applyStoreItemDecrementAfterSale,
  getCommerceFoundationCutoverState,
  finalizeFoundationCheckoutPayment,
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
    },
    assertLegacyDrainFinalizerAllowed: vi.fn(async () => {}),
    applyStoreItemDecrementAfterSale: vi.fn(async () => {}),
    getCommerceFoundationCutoverState: vi.fn(async () => ({ mode: "LEGACY" })),
    finalizeFoundationCheckoutPayment: vi.fn(async () => ({
      converted: 0,
      alreadyFinalized: true,
      attemptId: "att_1",
    })),
    CommerceFoundationCutoverBlockedError,
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
  failCheckoutAttemptAndRelease: vi.fn(async () => {}),
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
    expect(mockPrisma.storeOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord-f" },
        data: expect.objectContaining({ status: "paid" }),
      })
    );
  });
});
