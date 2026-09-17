import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSessionForApi, cancelMemberActiveSubscriptions } = vi.hoisted(() => ({
  getSessionForApi: vi.fn(),
  cancelMemberActiveSubscriptions: vi.fn(),
}));

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi,
}));

vi.mock("@/lib/cancel-member-active-subscriptions", () => ({
  cancelMemberActiveSubscriptions,
}));

vi.mock("@/lib/stripe-secret-key", () => ({
  STRIPE_NOT_CONFIGURED_MESSAGE: "Stripe is not configured",
}));

import { POST } from "@/app/api/stripe/subscription/cancel/route";

function req(body?: unknown) {
  return new NextRequest("http://localhost/api/stripe/subscription/cancel", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/stripe/subscription/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionForApi.mockResolvedValue({ user: { id: "m1" } });
  });

  it("cancels immediately and returns canceled count", async () => {
    cancelMemberActiveSubscriptions.mockResolvedValue({
      configured: true,
      noCustomer: false,
      ok: true,
      canceled: 1,
      billingCleanupPending: false,
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, canceled: 1 });
    expect(cancelMemberActiveSubscriptions).toHaveBeenCalledWith("m1", { atPeriodEnd: false });
  });

  it("passes atPeriodEnd through", async () => {
    cancelMemberActiveSubscriptions.mockResolvedValue({
      configured: true,
      noCustomer: false,
      ok: true,
      canceled: 1,
      billingCleanupPending: false,
    });
    await POST(req({ atPeriodEnd: true }));
    expect(cancelMemberActiveSubscriptions).toHaveBeenCalledWith("m1", { atPeriodEnd: true });
  });

  it("returns 400 when there is no billing customer", async () => {
    cancelMemberActiveSubscriptions.mockResolvedValue({
      configured: true,
      noCustomer: true,
      ok: true,
      canceled: 0,
      billingCleanupPending: false,
    });
    const res = await POST(req());
    expect(res.status).toBe(400);
  });

  it("returns 503 when Stripe is not configured", async () => {
    cancelMemberActiveSubscriptions.mockResolvedValue({
      configured: false,
      noCustomer: false,
      ok: false,
      canceled: 0,
      billingCleanupPending: true,
    });
    const res = await POST(req());
    expect(res.status).toBe(503);
  });

  it("returns 401 when unauthenticated", async () => {
    getSessionForApi.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
  });
});
