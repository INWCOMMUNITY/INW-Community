import { describe, expect, it, vi } from "vitest";
import {
  claimStoreReturnReceiptForRefund,
  markStoreReturnRefundedOnce,
} from "./store-return-receive";

function makeDb(locked: {
  status: string;
  refundAmountCents?: number | null;
  receivedAt?: Date | null;
  returnLabelCostCents?: number | null;
  orderStatus?: string;
}) {
  const storeReturn = {
    findUnique: vi.fn(async () => ({
      id: "ret-1",
      orderId: "ord-1",
      status: locked.status,
      refundAmountCents: locked.refundAmountCents ?? null,
      receivedAt: locked.receivedAt ?? null,
      returnLabelCostCents: "returnLabelCostCents" in locked ? locked.returnLabelCostCents ?? null : null,
      chargeReturnShipping: false,
    })),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const storeOrder = {
    findUnique: vi.fn(async () => ({ status: locked.orderStatus ?? "delivered" })),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    storeReturn,
    storeOrder,
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    storeReturn,
  };
  return { prisma, tx };
}

const order = { totalCents: 10000, subtotalCents: 10000, taxCents: 100 };

describe("claimStoreReturnReceiptForRefund", () => {
  it("records physical receipt once and snapshots the refund amount", async () => {
    const { prisma, tx } = makeDb({ status: "awaiting_return" });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 850,
      chargeReturnShipping: false,
    });
    expect(result.action).toBe("refund");
    if (result.action === "refund") {
      expect(result.firstReceipt).toBe(true);
      expect(result.amountCents).toBe(10100);
    }
    expect(tx.storeReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "received",
          refundAmountCents: 10100,
        }),
      })
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("resumes a received return without rewriting receivedAt or amount", async () => {
    const receivedAt = new Date("2026-09-01T00:00:00.000Z");
    const { prisma, tx } = makeDb({
      status: "received",
      refundAmountCents: 9250,
      receivedAt,
      returnLabelCostCents: 850,
    });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 9999,
      chargeReturnShipping: true,
    });
    expect(result.action).toBe("refund");
    if (result.action === "refund") {
      expect(result.firstReceipt).toBe(false);
      expect(result.amountCents).toBe(9250);
    }
    expect(tx.storeReturn.update.mock.calls[0][0].data.receivedAt).toEqual(receivedAt);
    expect(tx.storeReturn.update.mock.calls[0][0].data.refundAmountCents).toBe(9250);
  });

  it("finalizes when the StoreOrder is already refunded", async () => {
    const { prisma } = makeDb({
      status: "received",
      refundAmountCents: 10100,
      receivedAt: new Date(),
      orderStatus: "refunded",
    });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 0,
      chargeReturnShipping: false,
    });
    expect(result.action).toBe("order_already_refunded");
  });

  it("treats a refunded return as already complete", async () => {
    const { prisma, tx } = makeDb({ status: "refunded", refundAmountCents: 10100 });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 0,
      chargeReturnShipping: false,
    });
    expect(result.action).toBe("already_complete");
    expect(tx.storeReturn.update).not.toHaveBeenCalled();
  });

  it("rejects requested/declined returns", async () => {
    const { prisma } = makeDb({ status: "requested" });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 0,
      chargeReturnShipping: false,
    });
    expect(result.action).toBe("ineligible");
  });

  it("snapshots a legitimate zero-dollar refund without treating it as invalid", async () => {
    const { prisma, tx } = makeDb({ status: "awaiting_return" });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order: { totalCents: 500, subtotalCents: 500, taxCents: 0 },
      labelCostCents: 900,
      chargeReturnShipping: true,
    });
    expect(result.action).toBe("refund");
    if (result.action === "refund") {
      expect(result.amountCents).toBe(0);
      expect(result.refundArgs.transferReversalCents).toBe(0);
      expect(result.refundArgs.ledgerDebitCents).toBe(0);
    }
    expect(tx.storeReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "received", refundAmountCents: 0 }),
      })
    );
  });

  it("fails closed on a corrupt negative snapshotted amount without rewriting receipt", async () => {
    const receivedAt = new Date("2026-09-01T00:00:00.000Z");
    const { prisma, tx } = makeDb({
      status: "received",
      refundAmountCents: -1,
      receivedAt,
    });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 0,
      chargeReturnShipping: false,
    });
    expect(result.action).toBe("invalid_amount");
    expect(tx.storeReturn.update).not.toHaveBeenCalled();
  });

  it("keeps a snapshotted zero return-label cost on retry", async () => {
    const receivedAt = new Date("2026-09-01T00:00:00.000Z");
    const { prisma, tx } = makeDb({
      status: "received",
      refundAmountCents: 10000,
      receivedAt,
      returnLabelCostCents: 0,
    });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 1000,
      chargeReturnShipping: true,
    });
    expect(result.action).toBe("refund");
    expect(tx.storeReturn.update.mock.calls[0][0].data.returnLabelCostCents).toBe(0);
  });

  it("uses frozen label 0 for seller cents when a retry supplies 1000", async () => {
    const receivedAt = new Date("2026-09-01T00:00:00.000Z");
    const { prisma, tx } = makeDb({
      status: "received",
      refundAmountCents: 10000,
      receivedAt,
      returnLabelCostCents: 0,
    });
    const result = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 1000,
      chargeReturnShipping: true,
    });
    expect(result.action).toBe("refund");
    if (result.action === "refund") {
      expect(result.refundArgs.ledgerDebitCents).toBe(9900);
      expect(result.refundArgs.transferReversalCents).toBe(9900);
      expect(result.refundArgs.amountCents).toBe(10000);
    }
    expect(tx.storeReturn.update.mock.calls[0][0].data.returnLabelCostCents).toBe(0);
  });

  it("snapshots a null return-label cost from the first provided value", async () => {
    const { prisma, tx } = makeDb({
      status: "awaiting_return",
      returnLabelCostCents: null,
    });
    const first = await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 1000,
      chargeReturnShipping: true,
    });
    expect(first.action).toBe("refund");
    expect(tx.storeReturn.update.mock.calls[0][0].data.returnLabelCostCents).toBe(1000);
  });

  it("retains a frozen non-zero label cost on subsequent retries", async () => {
    const { prisma, tx } = makeDb({
      status: "received",
      refundAmountCents: 9100,
      receivedAt: new Date(),
      returnLabelCostCents: 1000,
    });
    await claimStoreReturnReceiptForRefund(prisma as never, {
      storeOrderId: "ord-1",
      storeReturnId: "ret-1",
      order,
      labelCostCents: 2500,
      chargeReturnShipping: true,
    });
    expect(tx.storeReturn.update.mock.calls[0][0].data.returnLabelCostCents).toBe(1000);
    expect(tx.storeReturn.update.mock.calls[0][0].data.refundAmountCents).toBe(9100);
  });
});

describe("markStoreReturnRefundedOnce", () => {
  it("CAS only received → refunded", async () => {
    const prisma = {
      storeReturn: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    await expect(markStoreReturnRefundedOnce(prisma as never, { storeReturnId: "ret-1", amountCents: 10 })).resolves.toBe(
      true
    );
    expect(prisma.storeReturn.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ret-1", status: "received" },
        data: expect.objectContaining({ status: "refunded" }),
      })
    );
    prisma.storeReturn.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(markStoreReturnRefundedOnce(prisma as never, { storeReturnId: "ret-1", amountCents: 10 })).resolves.toBe(
      false
    );
  });
});
