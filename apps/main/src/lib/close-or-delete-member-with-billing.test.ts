import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeOrDeleteMemberAccount, cancelMemberActiveSubscriptions } = vi.hoisted(() => ({
  closeOrDeleteMemberAccount: vi.fn(),
  cancelMemberActiveSubscriptions: vi.fn(),
}));

vi.mock("database", () => ({
  prisma: {},
  closeOrDeleteMemberAccount,
}));

vi.mock("@/lib/cancel-member-active-subscriptions", () => ({
  cancelMemberActiveSubscriptions,
}));

import { closeOrDeleteMemberAccountWithBilling } from "./close-or-delete-member-with-billing";

describe("closeOrDeleteMemberAccountWithBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hard-delete skips Stripe and returns billingCleanupPending false", async () => {
    closeOrDeleteMemberAccount.mockResolvedValue({ ok: true, outcome: "deleted" });
    const result = await closeOrDeleteMemberAccountWithBilling("m1");
    expect(cancelMemberActiveSubscriptions).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      outcome: "deleted",
      billingCleanupPending: false,
    });
  });

  it("closes first, then cancels Stripe; success → billingCleanupPending false", async () => {
    const order: string[] = [];
    closeOrDeleteMemberAccount.mockImplementation(async () => {
      order.push("close");
      return { ok: true, outcome: "closed" };
    });
    cancelMemberActiveSubscriptions.mockImplementation(async () => {
      order.push("stripe");
      return { billingCleanupPending: false, canceled: 1, ok: true };
    });
    const result = await closeOrDeleteMemberAccountWithBilling("m1");
    expect(order).toEqual(["close", "stripe"]);
    expect(result).toEqual({
      ok: true,
      outcome: "closed",
      billingCleanupPending: false,
    });
  });

  it("failed Stripe cancel leaves billingCleanupPending true and does not reopen", async () => {
    closeOrDeleteMemberAccount.mockResolvedValue({ ok: true, outcome: "closed" });
    cancelMemberActiveSubscriptions.mockResolvedValue({
      billingCleanupPending: true,
      canceled: 0,
      ok: false,
    });
    const result = await closeOrDeleteMemberAccountWithBilling("m1");
    expect(result).toEqual({
      ok: true,
      outcome: "closed",
      billingCleanupPending: true,
    });
    expect(closeOrDeleteMemberAccount).toHaveBeenCalledTimes(1);
  });

  it("retained close with no Stripe work needed → billingCleanupPending false", async () => {
    closeOrDeleteMemberAccount.mockResolvedValue({ ok: true, outcome: "closed" });
    cancelMemberActiveSubscriptions.mockResolvedValue({
      billingCleanupPending: false,
      canceled: 0,
      ok: true,
    });
    const result = await closeOrDeleteMemberAccountWithBilling("m-commerce");
    expect(result.billingCleanupPending).toBe(false);
  });
});
