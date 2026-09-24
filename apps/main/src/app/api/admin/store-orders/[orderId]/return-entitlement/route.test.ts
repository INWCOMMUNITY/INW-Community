import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAdmin, getFoundationReturnEntitlementAdminState } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => true),
  getFoundationReturnEntitlementAdminState: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("database", () => ({
  prisma: {},
  getFoundationReturnEntitlementAdminState,
}));

import { GET } from "./route";

function req(orderId = "ord-1") {
  return new NextRequest(`http://localhost/api/admin/store-orders/${orderId}/return-entitlement`);
}

describe("GET /api/admin/store-orders/[orderId]/return-entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(true);
  });

  it("rejects unauthorized callers", async () => {
    requireAdmin.mockResolvedValue(false);
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(401);
    expect(getFoundationReturnEntitlementAdminState).not.toHaveBeenCalled();
  });

  it("returns 404 when entitlement is missing", async () => {
    getFoundationReturnEntitlementAdminState.mockResolvedValue(null);
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns admin read model for FAILED with resetAllowed", async () => {
    getFoundationReturnEntitlementAdminState.mockResolvedValue({
      operationId: "sreo_1",
      storeOrderId: "ord-1",
      storeReturnId: "ret_1",
      sellerId: "seller_1",
      amountCents: 1000,
      currency: "usd",
      status: "FAILED",
      retryCount: 1,
      lastError: "stripe_failed",
      lastAttemptAt: new Date("2026-03-01T00:00:00.000Z"),
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:10:00.000Z"),
      succeededAt: null,
      stripeTransferId: null,
      stripeDestinationAccountId: "acct_A",
      stripeSourceChargeId: "ch_A",
      providerIdempotencyKey: "nwc_store_return_entitlement_ord-1",
      resetAllowed: true,
      resetBlockedReason: null,
      context: {
        storeReturnStatus: "received",
        storeOrderStatus: "delivered",
        transferOperationStatus: null,
        transferStripeTransferId: null,
        refundOperationStatus: null,
        refundStripeRefundId: null,
      },
    });
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("FAILED");
    expect(body.resetAllowed).toBe(true);
    expect(body.resetBlockedReason).toBeNull();
    expect(body.providerIdempotencyKey).toBe("nwc_store_return_entitlement_ord-1");
    expect(getFoundationReturnEntitlementAdminState).toHaveBeenCalledWith(expect.anything(), {
      storeOrderId: "ord-1",
    });
  });

  it("returns resetAllowed false for PENDING", async () => {
    getFoundationReturnEntitlementAdminState.mockResolvedValue({
      operationId: "sreo_1",
      storeOrderId: "ord-1",
      storeReturnId: "ret_1",
      sellerId: "seller_1",
      amountCents: 1000,
      currency: "usd",
      status: "PENDING",
      retryCount: 0,
      lastError: null,
      lastAttemptAt: null,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      succeededAt: null,
      stripeTransferId: null,
      stripeDestinationAccountId: null,
      stripeSourceChargeId: null,
      providerIdempotencyKey: "nwc_store_return_entitlement_ord-1",
      resetAllowed: false,
      resetBlockedReason: "PENDING",
      context: {
        storeReturnStatus: "received",
        storeOrderStatus: "delivered",
        transferOperationStatus: null,
        transferStripeTransferId: null,
        refundOperationStatus: null,
        refundStripeRefundId: null,
      },
    });
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resetAllowed).toBe(false);
    expect(body.resetBlockedReason).toBe("PENDING");
  });

  it("returns 500 without secrets on unexpected errors", async () => {
    getFoundationReturnEntitlementAdminState.mockRejectedValue(new Error("db down"));
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "read_failed" });
  });
});
