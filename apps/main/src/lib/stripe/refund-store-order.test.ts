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
      storeOrder: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    },
    assertLegacyInteractiveMutationAllowed: vi.fn(async () => {}),
    restockOrderLinesAfterReturn: vi.fn(async () => ["item-1"]),
    CommerceFoundationCutoverBlockedError,
  };
});

vi.mock("database", () => ({
  prisma: mockPrisma,
  assertLegacyInteractiveMutationAllowed,
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
