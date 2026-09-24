import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockPrisma,
  getSessionForApi,
  requireAdmin,
  assertLegacyInteractiveMutationAllowed,
  getCommerceFoundationCutoverState,
  CommerceFoundationCutoverBlockedError,
} = vi.hoisted(() => {
  class CommerceFoundationCutoverBlockedError extends Error {
    code = "inventory_cutover_frozen";
    retryable = true as const;
    httpStatus = 503 as const;
    constructor() {
      super("blocked");
      this.name = "CommerceFoundationCutoverBlockedError";
    }
  }
  return {
    mockPrisma: {
      storeItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      storeOrder: { findFirst: vi.fn() },
      subscription: { findFirst: vi.fn() },
      member: { findUnique: vi.fn() },
    },
    getSessionForApi: vi.fn(),
    requireAdmin: vi.fn(),
    assertLegacyInteractiveMutationAllowed: vi.fn(async () => {}),
    getCommerceFoundationCutoverState: vi.fn(async () => ({ mode: "FROZEN" })),
    CommerceFoundationCutoverBlockedError,
  };
});

vi.mock("database", () => ({
  prisma: mockPrisma,
  Prisma: {},
  assertLegacyInteractiveMutationAllowed,
  getCommerceFoundationCutoverState,
  commerceInventoryWriterRoute: (mode: string) =>
    mode === "LEGACY" ? "legacy" : mode === "FOUNDATION" || mode === "UNFROZEN" ? "foundation" : "blocked",
  CommerceFoundationCutoverBlockedError,
  isCommerceFoundationCutoverBlockedError: (err: unknown) =>
    err instanceof CommerceFoundationCutoverBlockedError,
  applyFoundationSellerQuantitySets: vi.fn(),
  assertFoundationMatrixStructureUnchanged: vi.fn(),
  markFoundationListingSold: vi.fn(),
  endFoundationListing: vi.fn(),
  relistFoundationListing: vi.fn(),
  prepareFoundationCheckout: vi.fn(),
  stripeCheckoutRequestOptions: (attempt: { stripeIdempotencyKey: string }) => ({
    idempotencyKey: attempt.stripeIdempotencyKey,
  }),
  FoundationCheckoutReuseError: class FoundationCheckoutReuseError extends Error {},
}));

vi.mock("@/lib/mobile-auth", () => ({ getSessionForApi }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/seller-activity-log", () => ({ logSellerActivity: vi.fn() }));
vi.mock("@/lib/content-moderation", () => ({
  containsProhibitedCategory: () => false,
  formatModerationErrorMessage: () => "",
  validateText: () => ({ ok: true }),
}));
vi.mock("@/lib/store-listing-stripe-rules", () => ({
  memberHasStripeConnectForStorefront: vi.fn(async () => true),
}));

import { PATCH as sellerPatch } from "@/app/api/store-items/[id]/route";
import { POST as relist } from "@/app/api/store-items/[id]/relist/route";
import { POST as storefrontCheckout } from "@/app/api/stripe/storefront-checkout/route";
import { POST as sellerCancel } from "@/app/api/store-orders/[id]/seller-cancel/route";
import { cutoverBlockedJsonResponse, jsonIfCutoverBlocked } from "./commerce-foundation-cutover-http";

const sellerId = "seller-1";

describe("commerce foundation cutover HTTP mapping", () => {
  it("maps the typed blocked error to 503 inventory_cutover_frozen", async () => {
    const res = cutoverBlockedJsonResponse();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "inventory_cutover_frozen", retryable: true });
    const mapped = jsonIfCutoverBlocked(new CommerceFoundationCutoverBlockedError());
    expect(mapped?.status).toBe(503);
    expect(jsonIfCutoverBlocked(new Error("nope"))).toBeNull();
  });
});

describe("representative interactive writers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionForApi.mockResolvedValue({ user: { id: sellerId } });
    requireAdmin.mockResolvedValue(false);
    assertLegacyInteractiveMutationAllowed.mockRejectedValue(new CommerceFoundationCutoverBlockedError());
    mockPrisma.storeItem.findUnique.mockResolvedValue({
      id: "item-1",
      memberId: sellerId,
      status: "active",
      quantity: 2,
    });
  });

  it("seller edit is blocked in FROZEN/non-LEGACY", async () => {
    const res = await sellerPatch(
      new NextRequest("http://localhost/api/store-items/item-1", { method: "PATCH" }),
      { params: Promise.resolve({ id: "item-1" }) }
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "inventory_cutover_frozen", retryable: true });
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
  });

  it("relist is blocked in FROZEN/non-LEGACY", async () => {
    const res = await relist(
      new NextRequest("http://localhost/api/store-items/item-1/relist", { method: "POST" }),
      { params: Promise.resolve({ id: "item-1" }) }
    );
    expect(res.status).toBe(503);
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
  });

  it("checkout creation is blocked in FROZEN/non-LEGACY", async () => {
    const res = await storefrontCheckout(
      new NextRequest("http://localhost/api/stripe/storefront-checkout", { method: "POST" })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "inventory_cutover_frozen", retryable: true });
  });

  it("seller cancel/restock is blocked in FROZEN/non-LEGACY", async () => {
    const res = await sellerCancel(
      new NextRequest("http://localhost/api/store-orders/order-1/seller-cancel", { method: "POST" }),
      { params: Promise.resolve({ id: "order-1" }) }
    );
    expect(res.status).toBe(503);
    expect(mockPrisma.storeOrder.findFirst).not.toHaveBeenCalled();
  });

  it("LEGACY seller edit proceeds past the cutover gate", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    assertLegacyInteractiveMutationAllowed.mockResolvedValue(undefined);
    const res = await sellerPatch(
      new NextRequest("http://localhost/api/store-items/item-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "ok" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "item-1" }) }
    );
    expect(res.status).not.toBe(503);
    expect(getCommerceFoundationCutoverState).toHaveBeenCalled();
  });
});
