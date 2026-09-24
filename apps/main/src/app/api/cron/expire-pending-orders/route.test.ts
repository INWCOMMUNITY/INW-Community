import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, fulfillStoreOrdersFromCheckoutSession, finalizeFoundationCheckoutPayment } = vi.hoisted(() => ({
  mockPrisma: {
    storeOrder: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    checkoutAttempt: { findUnique: vi.fn() },
  },
  fulfillStoreOrdersFromCheckoutSession: vi.fn(async () => ({ orderIds: [] })),
  finalizeFoundationCheckoutPayment: vi.fn(),
}));

vi.mock("database", () => ({
  prisma: mockPrisma,
  finalizeFoundationCheckoutPayment,
  foundationAttemptExpiryDecision: () => "hold",
}));

vi.mock("@/lib/stripe/fulfill-storefront-orders", () => ({
  fulfillStoreOrdersFromCheckoutSession,
}));

import { GET } from "./route";

describe("expire-pending-orders payout-unresolved paid sales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron";
    delete process.env.STRIPE_SECRET_KEY;
    mockPrisma.storeOrder.findMany.mockResolvedValue([]);
    mockPrisma.storeOrder.updateMany.mockResolvedValue({ count: 0 });
  });

  it("does not select paid FINALIZED orders with FAILED/UNCERTAIN payout", async () => {
    const req = new NextRequest("http://localhost/api/cron/expire-pending-orders", {
      headers: { authorization: "Bearer test-cron" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const pendingQuery = mockPrisma.storeOrder.findMany.mock.calls[0]?.[0];
    expect(pendingQuery.where.status).toBe("pending");
    expect(fulfillStoreOrdersFromCheckoutSession).not.toHaveBeenCalled();
    expect(mockPrisma.storeOrder.updateMany).not.toHaveBeenCalled();
    expect(finalizeFoundationCheckoutPayment).not.toHaveBeenCalled();
  });
});
