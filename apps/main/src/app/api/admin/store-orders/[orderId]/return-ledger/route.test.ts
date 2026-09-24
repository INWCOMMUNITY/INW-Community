import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAdmin, getFoundationReturnLedgerAdminState } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => true),
  getFoundationReturnLedgerAdminState: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/foundation-return-ledger-admin", () => ({
  getFoundationReturnLedgerAdminState,
}));
vi.mock("@/lib/stripe/seller-return-entitlement", () => {
  throw new Error("executeSellerReturnEntitlement must not be imported by return-ledger route");
});
vi.mock("@/lib/stripe", () => {
  throw new Error("stripe client must not be imported by return-ledger route");
});

import { GET } from "./route";

function req(orderId = "ord-1") {
  return new NextRequest(`http://localhost/api/admin/store-orders/${orderId}/return-ledger`);
}

function healthyState(overrides: Record<string, unknown> = {}) {
  return {
    storeOrderId: "ord-1",
    sellerId: "seller-1",
    returnLedger: {
      expected: true,
      expectedAmountCents: -9900,
      classification: "EXACT",
      rowCount: 1,
      exactCount: 1,
      conflictCount: 0,
      exactRowIds: ["sbt_1"],
      conflictRowIds: [],
      rows: [
        {
          id: "sbt_1",
          memberId: "seller-1",
          orderId: "ord-1",
          type: "return",
          amountCents: -9900,
          stripeTransferId: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          description: null,
        },
      ],
    },
    returnEntitlementLedger: {
      expected: false,
      expectedAmountCents: null,
      expectedStripeTransferId: null,
      entitlementOperationId: null,
      classification: "NONE_EXPECTED",
      rowCount: 0,
      exactCount: 0,
      conflictCount: 0,
      exactRowIds: [],
      conflictRowIds: [],
      rows: [],
    },
    hasLedgerAnomaly: false,
    ...overrides,
  };
}

describe("GET /api/admin/store-orders/[orderId]/return-ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(true);
  });

  it("rejects unauthorized callers before reading", async () => {
    requireAdmin.mockResolvedValue(false);
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(401);
    expect(getFoundationReturnLedgerAdminState).not.toHaveBeenCalled();
  });

  it("returns 404 when the order is missing", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(null);
    const res = await GET(req(), { params: { orderId: "missing" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns healthy exact Path-A state", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(healthyState());
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.returnLedger.classification).toBe("EXACT");
    expect(body.hasLedgerAnomaly).toBe(false);
    expect(getFoundationReturnLedgerAdminState).toHaveBeenCalledWith({ storeOrderId: "ord-1" });
  });

  it("returns duplicate exact return rows with hasLedgerAnomaly", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(
      healthyState({
        returnLedger: {
          ...healthyState().returnLedger,
          classification: "DUPLICATE_EXACT",
          rowCount: 2,
          exactCount: 2,
          exactRowIds: ["a", "b"],
        },
        hasLedgerAnomaly: true,
      })
    );
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    const body = await res.json();
    expect(body.returnLedger.classification).toBe("DUPLICATE_EXACT");
    expect(body.hasLedgerAnomaly).toBe(true);
  });

  it("returns exact-plus-conflict return rows", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(
      healthyState({
        returnLedger: {
          ...healthyState().returnLedger,
          classification: "EXACT_PLUS_CONFLICT",
          rowCount: 2,
          exactCount: 1,
          conflictCount: 1,
        },
        hasLedgerAnomaly: true,
      })
    );
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect((await res.json()).returnLedger.classification).toBe("EXACT_PLUS_CONFLICT");
  });

  it("returns healthy entitlement ledger", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(
      healthyState({
        returnLedger: {
          expected: false,
          expectedAmountCents: null,
          classification: "NONE_EXPECTED",
          rowCount: 0,
          exactCount: 0,
          conflictCount: 0,
          exactRowIds: [],
          conflictRowIds: [],
          rows: [],
        },
        returnEntitlementLedger: {
          expected: true,
          expectedAmountCents: 1000,
          expectedStripeTransferId: "tr_1",
          entitlementOperationId: "sreo_1",
          classification: "EXACT",
          rowCount: 1,
          exactCount: 1,
          conflictCount: 0,
          exactRowIds: ["e1"],
          conflictRowIds: [],
          rows: [],
        },
      })
    );
    const body = await (await GET(req(), { params: { orderId: "ord-1" } })).json();
    expect(body.returnEntitlementLedger.classification).toBe("EXACT");
    expect(body.hasLedgerAnomaly).toBe(false);
  });

  it("returns duplicate entitlement rows", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(
      healthyState({
        returnEntitlementLedger: {
          expected: true,
          expectedAmountCents: 1000,
          expectedStripeTransferId: "tr_1",
          entitlementOperationId: "sreo_1",
          classification: "DUPLICATE_EXACT",
          rowCount: 2,
          exactCount: 2,
          conflictCount: 0,
          exactRowIds: ["e1", "e2"],
          conflictRowIds: [],
          rows: [],
        },
        hasLedgerAnomaly: true,
      })
    );
    const body = await (await GET(req(), { params: { orderId: "ord-1" } })).json();
    expect(body.returnEntitlementLedger.classification).toBe("DUPLICATE_EXACT");
    expect(body.hasLedgerAnomaly).toBe(true);
  });

  it("returns conflict-only entitlement rows", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(
      healthyState({
        returnEntitlementLedger: {
          expected: true,
          expectedAmountCents: 1000,
          expectedStripeTransferId: "tr_1",
          entitlementOperationId: "sreo_1",
          classification: "CONFLICT_ONLY",
          rowCount: 1,
          exactCount: 0,
          conflictCount: 1,
          exactRowIds: [],
          conflictRowIds: ["bad"],
          rows: [],
        },
        hasLedgerAnomaly: true,
      })
    );
    const body = await (await GET(req(), { params: { orderId: "ord-1" } })).json();
    expect(body.returnEntitlementLedger.classification).toBe("CONFLICT_ONLY");
  });

  it("returns both ledger types anomalous simultaneously", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(
      healthyState({
        returnLedger: {
          ...healthyState().returnLedger,
          classification: "DUPLICATE_EXACT",
          rowCount: 2,
          exactCount: 2,
        },
        returnEntitlementLedger: {
          expected: true,
          expectedAmountCents: 1000,
          expectedStripeTransferId: "tr_1",
          entitlementOperationId: "sreo_1",
          classification: "CONFLICT_ONLY",
          rowCount: 1,
          exactCount: 0,
          conflictCount: 1,
          exactRowIds: [],
          conflictRowIds: ["bad"],
          rows: [],
        },
        hasLedgerAnomaly: true,
      })
    );
    const body = await (await GET(req(), { params: { orderId: "ord-1" } })).json();
    expect(body.returnLedger.classification).toBe("DUPLICATE_EXACT");
    expect(body.returnEntitlementLedger.classification).toBe("CONFLICT_ONLY");
    expect(body.hasLedgerAnomaly).toBe(true);
  });

  it("returns machine-readable classifications without mutating", async () => {
    getFoundationReturnLedgerAdminState.mockResolvedValue(healthyState());
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    const body = await res.json();
    expect(body.returnLedger).toMatchObject({
      classification: "EXACT",
      exactCount: 1,
      conflictCount: 0,
    });
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        "storeOrderId",
        "sellerId",
        "returnLedger",
        "returnEntitlementLedger",
        "hasLedgerAnomaly",
      ])
    );
  });

  it("returns 500 without secrets on unexpected errors", async () => {
    getFoundationReturnLedgerAdminState.mockRejectedValue(new Error("db down"));
    const res = await GET(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "read_failed" });
  });
});
