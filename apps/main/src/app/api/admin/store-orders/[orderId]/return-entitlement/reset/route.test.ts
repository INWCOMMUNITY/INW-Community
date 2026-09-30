import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAdmin, resetFoundationSellerReturnEntitlementForRetry } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => true),
  resetFoundationSellerReturnEntitlementForRetry: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("database", () => ({
  prisma: {},
  resetFoundationSellerReturnEntitlementForRetry,
}));

// Prove reset route never imports provider execution / Stripe.
vi.mock("@/lib/stripe/seller-return-entitlement", () => {
  throw new Error("executeSellerReturnEntitlement must not be imported by reset route");
});
vi.mock("@/lib/stripe", () => {
  throw new Error("stripe client must not be imported by reset route");
});

import { POST } from "./route";

function req(orderId = "ord-1") {
  return new NextRequest(`http://localhost/api/admin/store-orders/${orderId}/return-entitlement/reset`, {
    method: "POST",
  });
}

describe("POST /api/admin/store-orders/[orderId]/return-entitlement/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(true);
  });

  it("rejects unauthorized callers without calling reset", async () => {
    requireAdmin.mockResolvedValue(false);
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(401);
    expect(resetFoundationSellerReturnEntitlementForRetry).not.toHaveBeenCalled();
  });

  it("resets eligible FAILED entitlement without provider work", async () => {
    resetFoundationSellerReturnEntitlementForRetry.mockResolvedValue({
      kind: "RESET",
      operation: {
        id: "sreo_1",
        status: "PENDING",
        retryCount: 1,
        providerIdempotencyKey: "nwc_store_return_entitlement_ord-1",
        lastError: "operator_reset_for_retry",
      },
    });
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      storeOrderId: "ord-1",
      operationId: "sreo_1",
      status: "PENDING",
      retryCount: 1,
      providerIdempotencyKey: "nwc_store_return_entitlement_ord-1",
      lastError: "operator_reset_for_retry",
    });
    expect(resetFoundationSellerReturnEntitlementForRetry).toHaveBeenCalledWith(expect.anything(), {
      storeOrderId: "ord-1",
    });
  });

  it("returns 404 when entitlement is missing", async () => {
    resetFoundationSellerReturnEntitlementForRetry.mockResolvedValue({ kind: "NOT_FOUND" });
    const res = await POST(req(), { params: { orderId: "ord-missing" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 409 for not-FAILED statuses", async () => {
    resetFoundationSellerReturnEntitlementForRetry.mockResolvedValue({
      kind: "NOT_FAILED",
      reason: "PENDING",
      operation: { status: "PENDING", retryCount: 1 },
    });
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "not_failed",
      reason: "PENDING",
      status: "PENDING",
      retryCount: 1,
    });
  });

  it("returns 409 when replay window expired", async () => {
    resetFoundationSellerReturnEntitlementForRetry.mockResolvedValue({
      kind: "REPLAY_WINDOW_EXPIRED",
      operation: { status: "FAILED", retryCount: 2 },
    });
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "replay_window_expired",
      status: "FAILED",
      retryCount: 2,
    });
  });

  it("returns 409 when attempted row is missing snapshot", async () => {
    resetFoundationSellerReturnEntitlementForRetry.mockResolvedValue({
      kind: "SNAPSHOT_MISSING",
      operation: { status: "FAILED", retryCount: 1 },
    });
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "snapshot_missing",
      status: "FAILED",
      retryCount: 1,
    });
  });

  it("returns 500 without secrets on unexpected DB errors", async () => {
    resetFoundationSellerReturnEntitlementForRetry.mockRejectedValue(new Error("db down"));
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "reset_failed" });
  });
});
