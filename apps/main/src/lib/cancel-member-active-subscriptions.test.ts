import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  resolveStripeCustomerIdForMember,
  syncStripeSubscriptionsForMember,
  resolveStripeSecretKey,
} = vi.hoisted(() => ({
  mockPrisma: {
    subscription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  resolveStripeCustomerIdForMember: vi.fn(),
  syncStripeSubscriptionsForMember: vi.fn(),
  resolveStripeSecretKey: vi.fn(),
}));

vi.mock("database", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/stripe-customer-for-member", () => ({
  resolveStripeCustomerIdForMember,
}));

vi.mock("@/lib/sync-stripe-subscriptions-for-member", () => ({
  syncStripeSubscriptionsForMember,
}));

vi.mock("@/lib/stripe-secret-key", () => ({
  resolveStripeSecretKey,
  STRIPE_NOT_CONFIGURED_MESSAGE: "Stripe is not configured",
}));

import { cancelMemberActiveSubscriptions } from "./cancel-member-active-subscriptions";

function mockStripe(overrides?: {
  listImpl?: (args: { status?: string }) => Promise<{ data: Array<Record<string, unknown>> }>;
  cancel?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  const cancel = overrides?.cancel ?? vi.fn().mockResolvedValue({ id: "sub_1", status: "canceled" });
  const update = overrides?.update ?? vi.fn();
  const list =
    overrides?.listImpl ??
    (async ({ status }: { status?: string }) => {
      if (status === "active") {
        return {
          data: [
            {
              id: "sub_1",
              metadata: { memberId: "m1", planId: "subscribe" },
            },
          ],
        };
      }
      return { data: [] };
    });
  return {
    subscriptions: {
      list: vi.fn(list),
      cancel,
      update,
    },
  };
}

describe("cancelMemberActiveSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    resolveStripeSecretKey.mockReturnValue("sk_test_abcdefghijklmnopqrstuv");
    resolveStripeCustomerIdForMember.mockResolvedValue("cus_1");
    syncStripeSubscriptionsForMember.mockResolvedValue({ synced: 1 });
  });

  it("returns billingCleanupPending false when there is nothing billable and no customer", async () => {
    resolveStripeCustomerIdForMember.mockResolvedValue(null);
    const stripe = mockStripe();
    const result = await cancelMemberActiveSubscriptions("m1", {
      stripe: stripe as never,
    });
    expect(result).toMatchObject({
      canceled: 0,
      billingCleanupPending: false,
      noCustomer: true,
      ok: true,
    });
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("cancels active NWC Stripe subscriptions then syncs; pending false after local row is no longer billable", async () => {
    mockPrisma.subscription.findFirst
      .mockResolvedValueOnce({ id: "local-1" })
      .mockResolvedValueOnce(null);
    mockPrisma.subscription.findMany.mockResolvedValue([{ stripeSubscriptionId: "sub_1" }]);
    const stripe = mockStripe();
    const result = await cancelMemberActiveSubscriptions("m1", { stripe: stripe as never });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(syncStripeSubscriptionsForMember).toHaveBeenCalledWith("m1", stripe);
    expect(result).toMatchObject({
      canceled: 1,
      billingCleanupPending: false,
      ok: true,
    });
  });

  it("does not write local cancellation when Stripe cancel throws; pending true", async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: "local-1" });
    mockPrisma.subscription.findMany.mockResolvedValue([{ stripeSubscriptionId: "sub_1" }]);
    const stripe = mockStripe({
      cancel: vi.fn().mockRejectedValue(new Error("stripe down")),
    });
    const result = await cancelMemberActiveSubscriptions("m1", { stripe: stripe as never });
    expect(syncStripeSubscriptionsForMember).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      canceled: 0,
      billingCleanupPending: true,
      ok: false,
    });
  });

  it("includes past_due and trialing in the list", async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    const stripe = mockStripe({
      listImpl: async ({ status }) => {
        if (status === "past_due") {
          return {
            data: [{ id: "sub_pd", metadata: { memberId: "m1", planId: "seller" } }],
          };
        }
        if (status === "trialing") {
          return {
            data: [{ id: "sub_tr", metadata: { memberId: "m1", planId: "sponsor" } }],
          };
        }
        return { data: [] };
      },
    });
    const result = await cancelMemberActiveSubscriptions("m1", { stripe: stripe as never });
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(3);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_tr");
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_pd");
    expect(result.canceled).toBe(2);
  });

  it("no matching Stripe subscriptions: no cancel call, sync runs, pending false", async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    const stripe = mockStripe({
      listImpl: async () => ({ data: [] }),
    });
    const result = await cancelMemberActiveSubscriptions("m1", { stripe: stripe as never });
    expect(stripe.subscriptions.list).toHaveBeenCalledTimes(3);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(syncStripeSubscriptionsForMember).toHaveBeenCalledWith("m1", stripe);
    expect(result).toMatchObject({
      canceled: 0,
      billingCleanupPending: false,
      ok: true,
    });
  });

  it("atPeriodEnd success stays ok even if the local row is still billable", async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: "local-1" });
    mockPrisma.subscription.findMany.mockResolvedValue([{ stripeSubscriptionId: "sub_1" }]);
    const stripe = mockStripe({
      update: vi.fn().mockResolvedValue({ id: "sub_1", cancel_at_period_end: true }),
    });
    const result = await cancelMemberActiveSubscriptions("m1", {
      atPeriodEnd: true,
      stripe: stripe as never,
    });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      canceled: 1,
      billingCleanupPending: true,
      ok: true,
    });
  });

  it("pending true when Stripe is not configured and a local billable row exists", async () => {
    resolveStripeSecretKey.mockReturnValue(null);
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: "local-1" });
    const result = await cancelMemberActiveSubscriptions("m1");
    expect(result).toMatchObject({
      configured: false,
      billingCleanupPending: true,
      ok: false,
    });
  });
});
