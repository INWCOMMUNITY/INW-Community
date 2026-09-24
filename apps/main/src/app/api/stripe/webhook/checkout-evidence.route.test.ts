import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { constructEvent, fulfillStoreOrdersFromCheckoutSession } = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  fulfillStoreOrdersFromCheckoutSession: vi.fn(async () => ({ orderIds: ["ord_1"] })),
}));

vi.mock("stripe", () => {
  class StripeMock {
    static webhooks = { constructEvent };
    webhooks = { constructEvent };
    constructor(_key?: string, _opts?: unknown) {}
  }
  return { default: StripeMock };
});

vi.mock("database", () => ({
  prisma: {
    member: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    storeOrder: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    storeItem: { findMany: vi.fn(), update: vi.fn() },
    subscription: { upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    business: { findFirst: vi.fn(), create: vi.fn() },
  },
  Prisma: {},
  getCommerceFoundationCutoverState: vi.fn(async () => ({ mode: "FOUNDATION" })),
  commerceInventoryWriterRoute: () => "foundation",
  assertLegacyDrainFinalizerAllowed: vi.fn(),
  isCommerceFoundationCutoverBlockedError: () => false,
  isPermanentFoundationNonconvertibleError: () => false,
  finalizeFoundationCheckoutPayment: vi.fn(),
  markFoundationAttemptUnfulfillable: vi.fn(),
  markFoundationStoreOrderPaidAfterConvert: vi.fn(),
  durableStartedAtFromUnixSeconds: (n: number) => new Date(n * 1000),
}));

vi.mock("@/lib/stripe/fulfill-storefront-orders", () => ({
  fulfillStoreOrdersFromCheckoutSession,
  ensureFoundationPayoutIntentsForAttempt: vi.fn(),
  syncStoreItemsAfterSale: vi.fn(),
}));

vi.mock("@/lib/commerce-foundation-cutover-http", () => ({
  jsonIfCutoverBlocked: () => null,
}));

vi.mock("@/lib/stripe-checkout-order-ids", () => ({
  orderIdsFromCheckoutSessionMetadata: () => ["ord_1"],
}));

describe("POST /api/stripe/webhook checkout evidence wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_platform";
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    delete process.env.STRIPE_THIN_WEBHOOK_SECRET;
  });

  it("rejects invalid signature without fulfilling", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const req = new NextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=bad" },
      body: Buffer.from("{}"),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fulfillStoreOrdersFromCheckoutSession).not.toHaveBeenCalled();
  });

  it("passes actual checkout.session.completed event.id into fulfill", async () => {
    const session = {
      id: "cs_test_1",
      mode: "payment",
      payment_status: "paid",
      metadata: { orderIds: "ord_1" },
      payment_intent: "pi_test_1",
    };
    constructEvent.mockReturnValue({
      id: "evt_live_csc_abc",
      type: "checkout.session.completed",
      data: { object: session },
      account: undefined,
    });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const req = new NextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: Buffer.from("{}"),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fulfillStoreOrdersFromCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      session,
      expect.objectContaining({
        logPrefix: "[webhook]",
        stripeEventId: "evt_live_csc_abc",
        eventType: "checkout.session.completed",
      })
    );
  });
});
