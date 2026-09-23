import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockPrisma,
  getSessionForApi,
  resolveCommerceInventoryWriter,
  completeReceivedStoreReturnSettlement,
  refundPaidStorefrontOrder,
  notifyBuyerRefundIssued,
} = vi.hoisted(() => ({
  mockPrisma: {
    subscription: { findFirst: vi.fn() },
    storeOrder: { findFirst: vi.fn() },
    storeReturn: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  getSessionForApi: vi.fn(),
  resolveCommerceInventoryWriter: vi.fn(async () => ({ ok: true as const, route: "foundation" as const })),
  completeReceivedStoreReturnSettlement: vi.fn(),
  refundPaidStorefrontOrder: vi.fn(),
  notifyBuyerRefundIssued: vi.fn(),
}));

vi.mock("database", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/mobile-auth", () => ({ getSessionForApi }));
vi.mock("@/lib/commerce-foundation-cutover-http", () => ({ resolveCommerceInventoryWriter }));
vi.mock("@/lib/store-return-settlement", () => ({ completeReceivedStoreReturnSettlement }));
vi.mock("@/lib/stripe/refund-store-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/refund-store-order")>();
  return { ...actual, refundPaidStorefrontOrder };
});
vi.mock("@/lib/store-return-notify", () => ({ notifyBuyerRefundIssued }));
vi.mock("@/lib/nwc-paid-subscription", () => ({
  prismaWhereMemberSellerPlanAccess: (id: string) => ({ memberId: id }),
}));

import { POST } from "./route";

const awaitingReturn = {
  id: "ret-1",
  orderId: "ord-1",
  status: "awaiting_return",
  reason: "Wrong item",
  note: null,
  chargeReturnShipping: false,
  refundAmountCents: null,
  receivedAt: null,
  returnLabelCostCents: 0,
  returnShipment: null,
};

const shippedOrder = {
  id: "ord-1",
  sellerId: "seller-1",
  buyerId: "buyer-1",
  status: "shipped",
  totalCents: 10000,
  subtotalCents: 10000,
  taxCents: 100,
  stripePaymentIntentId: "pi_1",
  items: [{ id: "oi-1", storeItemId: "item-1", quantity: 1, variant: null, variantId: "var-1" }],
  storeReturns: [awaitingReturn],
};

function req() {
  return new NextRequest("http://localhost/api/store-orders/ord-1/returns/receive", { method: "POST" });
}

function params() {
  return { params: Promise.resolve({ id: "ord-1" }) };
}

function lockTx(locked: {
  status: string;
  refundAmountCents?: number | null;
  receivedAt?: Date | null;
  orderStatus?: string;
}) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    storeReturn: {
      findUnique: vi.fn(async () => ({
        ...awaitingReturn,
        status: locked.status,
        refundAmountCents: locked.refundAmountCents ?? awaitingReturn.refundAmountCents,
        receivedAt: locked.receivedAt ?? awaitingReturn.receivedAt,
      })),
      update: vi.fn(async () => ({})),
    },
    storeOrder: {
      findUnique: vi.fn(async () => ({ status: locked.orderStatus ?? "shipped" })),
    },
  };
  mockPrisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return tx;
}

describe("POST /api/store-orders/[id]/returns/receive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionForApi.mockResolvedValue({ user: { id: "seller-1" } });
    resolveCommerceInventoryWriter.mockResolvedValue({ ok: true, route: "foundation" });
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: "sub-1" });
    mockPrisma.storeOrder.findFirst.mockResolvedValue(shippedOrder);
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "SETTLED",
      amountCents: 10100,
      newlyFinalized: true,
    });
    lockTx({ status: "awaiting_return" });
  });

  it("refunds after first physical receive", async () => {
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, refunded: true, amountCents: 10100 });
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        storeOrderId: "ord-1",
        storeReturnId: "ret-1",
        memberId: "seller-1",
      })
    );
    expect(notifyBuyerRefundIssued).toHaveBeenCalledWith("buyer-1", "ord-1");
  });

  it("retries after a failed provider refund without a second receipt rewrite", async () => {
    completeReceivedStoreReturnSettlement.mockResolvedValueOnce({
      kind: "BUYER_REFUND_FAILED",
      error: "card_decline",
      httpStatus: 500,
    });
    const first = await POST(req(), params());
    expect(first.status).toBe(500);
    expect(notifyBuyerRefundIssued).not.toHaveBeenCalled();

    lockTx({
      status: "received",
      refundAmountCents: 10100,
      receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 10100 }],
    });
    completeReceivedStoreReturnSettlement.mockResolvedValueOnce({
      kind: "SETTLED",
      amountCents: 10100,
      newlyFinalized: true,
    });
    const second = await POST(req(), params());
    expect(second.status).toBe(200);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledTimes(2);
  });

  it("retries a timeout with the same receive route", async () => {
    completeReceivedStoreReturnSettlement.mockResolvedValueOnce({
      kind: "BUYER_REFUND_PENDING",
      error: "Refund provider outcome is uncertain; retry the same refund",
      httpStatus: 500,
    });
    await POST(req(), params());
    lockTx({ status: "received", refundAmountCents: 10100, receivedAt: new Date() });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 10100 }],
    });
    completeReceivedStoreReturnSettlement.mockResolvedValueOnce({
      kind: "SETTLED",
      amountCents: 10100,
      newlyFinalized: true,
    });
    const retry = await POST(req(), params());
    expect(retry.status).toBe(200);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledTimes(2);
  });

  it("still settles when StoreOrder is already refunded and StoreReturn is received", async () => {
    lockTx({
      status: "received",
      refundAmountCents: 10100,
      receivedAt: new Date(),
      orderStatus: "refunded",
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      status: "refunded",
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 10100 }],
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledTimes(1);
  });

  it("does not notify twice when settlement did not newly finalize", async () => {
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "SETTLED",
      amountCents: 10100,
      newlyFinalized: false,
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(notifyBuyerRefundIssued).not.toHaveBeenCalled();
  });

  it("serializes concurrent receive into one notification", async () => {
    let inFlight = 0;
    let max = 0;
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      const tx = {
        $executeRaw: vi.fn(async () => 1),
        storeReturn: {
          findUnique: vi.fn(async () => ({ ...awaitingReturn, status: "awaiting_return" })),
          update: vi.fn(async () => ({})),
        },
        storeOrder: { findUnique: vi.fn(async () => ({ status: "shipped" })) },
      };
      const result = await fn(tx);
      inFlight -= 1;
      return result;
    });
    completeReceivedStoreReturnSettlement
      .mockResolvedValueOnce({ kind: "SETTLED", amountCents: 10100, newlyFinalized: true })
      .mockResolvedValueOnce({ kind: "SETTLED", amountCents: 10100, newlyFinalized: false });
    const [a, b] = await Promise.all([POST(req(), params()), POST(req(), params())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(notifyBuyerRefundIssued).toHaveBeenCalledTimes(1);
    expect(max).toBeGreaterThanOrEqual(1);
  });

  it("rejects requested returns that have not been approved", async () => {
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "requested" }],
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(400);
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
  });

  it("blocks FROZEN/BACKFILLING via the shared cutover gate", async () => {
    resolveCommerceInventoryWriter.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "inventory_cutover_frozen" }), { status: 503 }) as never,
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(503);
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
    expect(refundPaidStorefrontOrder).not.toHaveBeenCalled();
  });

  it("retries from received through the settlement orchestrator", async () => {
    lockTx({
      status: "received",
      refundAmountCents: 10100,
      receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 10100 }],
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ storeOrderId: "ord-1", storeReturnId: "ret-1", memberId: "seller-1" })
    );
  });

  it("completes a $0 return without treating it as an invalid refund", async () => {
    lockTx({
      status: "received",
      refundAmountCents: 0,
      receivedAt: new Date(),
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 0 }],
    });
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "SETTLED",
      amountCents: 0,
      newlyFinalized: true,
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, refunded: true, amountCents: 0 });
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalled();
  });

  it("settles a $0 return after StoreOrder already refunded", async () => {
    lockTx({
      status: "received",
      refundAmountCents: 0,
      receivedAt: new Date(),
      orderStatus: "refunded",
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      status: "refunded",
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 0 }],
    });
    completeReceivedStoreReturnSettlement.mockResolvedValue({
      kind: "SETTLED",
      amountCents: 0,
      newlyFinalized: true,
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledTimes(1);
    expect(notifyBuyerRefundIssued).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent $0 completions into one notification", async () => {
    lockTx({ status: "received", refundAmountCents: 0, receivedAt: new Date() });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 0 }],
    });
    completeReceivedStoreReturnSettlement
      .mockResolvedValueOnce({ kind: "SETTLED", amountCents: 0, newlyFinalized: true })
      .mockResolvedValueOnce({ kind: "SETTLED", amountCents: 0, newlyFinalized: false });
    const [a, b] = await Promise.all([POST(req(), params()), POST(req(), params())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(notifyBuyerRefundIssued).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a corrupt negative snapshotted amount", async () => {
    lockTx({ status: "received", refundAmountCents: -5, receivedAt: new Date() });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: -5 }],
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Refund amount is invalid; operator reconciliation is required.",
    });
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
  });

  it("does not settle when the return is already refunded", async () => {
    lockTx({ status: "refunded", refundAmountCents: 10100 });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      storeReturns: [{ ...awaitingReturn, status: "refunded", refundAmountCents: 10100 }],
    });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, refunded: true, amountCents: 10100 });
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
    expect(notifyBuyerRefundIssued).not.toHaveBeenCalled();
  });

  it("uses the legacy refund path when writerRoute is LEGACY even if a Connect transfer exists without TransferOperation", async () => {
    resolveCommerceInventoryWriter.mockResolvedValue({ ok: true, route: "legacy" });
    refundPaidStorefrontOrder.mockResolvedValue({
      ok: true,
      refunded: true,
      amountCents: 10000,
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      stripeSellerTransferId: "tr_legacy_connect",
    });
    mockPrisma.storeReturn.updateMany.mockResolvedValue({ count: 1 });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, refunded: true, amountCents: 10000 });
    expect(refundPaidStorefrontOrder).toHaveBeenCalledTimes(1);
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
    expect(notifyBuyerRefundIssued).toHaveBeenCalledTimes(1);
  });

  it("does not call Unit-4 settlement for a legacy already-refunded order", async () => {
    resolveCommerceInventoryWriter.mockResolvedValue({ ok: true, route: "legacy" });
    lockTx({
      status: "received",
      refundAmountCents: 10100,
      receivedAt: new Date(),
      orderStatus: "refunded",
    });
    mockPrisma.storeOrder.findFirst.mockResolvedValue({
      ...shippedOrder,
      status: "refunded",
      stripeSellerTransferId: "tr_legacy_connect",
      storeReturns: [{ ...awaitingReturn, status: "received", refundAmountCents: 10100 }],
    });
    mockPrisma.storeReturn.updateMany.mockResolvedValue({ count: 1 });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(refundPaidStorefrontOrder).not.toHaveBeenCalled();
    expect(completeReceivedStoreReturnSettlement).not.toHaveBeenCalled();
  });

  it("runs the Unit-4 Foundation orchestrator and never the legacy refund helper", async () => {
    resolveCommerceInventoryWriter.mockResolvedValue({ ok: true, route: "foundation" });
    const res = await POST(req(), params());
    expect(res.status).toBe(200);
    expect(completeReceivedStoreReturnSettlement).toHaveBeenCalledTimes(1);
    expect(refundPaidStorefrontOrder).not.toHaveBeenCalled();
  });
});
