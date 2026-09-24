import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAdmin, resetFoundationTransferForOperatorRetry, FoundationTransferResetError } = vi.hoisted(() => {
  class FoundationTransferResetError extends Error {
    resetCode: string;
    constructor(resetCode: string, message: string) {
      super(message);
      this.name = "FoundationTransferResetError";
      this.resetCode = resetCode;
    }
  }
  return {
    requireAdmin: vi.fn(async () => true),
    resetFoundationTransferForOperatorRetry: vi.fn(),
    FoundationTransferResetError,
  };
});

vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("database", () => ({
  prisma: {},
  resetFoundationTransferForOperatorRetry,
  FoundationTransferResetError,
}));

import { POST } from "./route";

function req() {
  return new NextRequest("http://localhost/api/admin/facilitator-payouts/ord-1/retry", { method: "POST" });
}

describe("POST /api/admin/facilitator-payouts/[orderId]/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(true);
  });

  it("resets eligible FAILED payouts without calling Stripe", async () => {
    resetFoundationTransferForOperatorRetry.mockResolvedValue({
      id: "top_1",
      status: "PENDING",
      retryCount: 0,
      providerIdempotencyKey: "nwc_store_transfer_ord-1",
    });
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("PENDING");
    expect(resetFoundationTransferForOperatorRetry).toHaveBeenCalledWith(expect.anything(), {
      storeOrderId: "ord-1",
    });
  });

  it("surfaces a finalized-active-sale rejection instead of requiring paid", async () => {
    resetFoundationTransferForOperatorRetry.mockRejectedValue(
      new FoundationTransferResetError(
        "order_not_finalized_active_sale",
        "StoreOrder ord-1 must be a finalized active sale"
      )
    );
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "order_not_finalized_active_sale",
      message: "StoreOrder ord-1 must be a finalized active sale",
    });
  });

  it("rejects unfulfillable reset", async () => {
    resetFoundationTransferForOperatorRetry.mockRejectedValue(
      new FoundationTransferResetError("terminal_local", "unfulfillable")
    );
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "terminal_local", message: "unfulfillable" });
  });

  it("rejects unauthorized callers", async () => {
    requireAdmin.mockResolvedValue(false);
    const res = await POST(req(), { params: { orderId: "ord-1" } });
    expect(res.status).toBe(401);
    expect(resetFoundationTransferForOperatorRetry).not.toHaveBeenCalled();
  });
});
