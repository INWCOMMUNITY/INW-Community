import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { storeItemStatusWrite } from "./store-item-ended-status";

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
      storeItem: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
      orderItem: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      bulkEditSnapshot: {
        create: vi.fn(),
      },
    },
    getSessionForApi: vi.fn(),
    requireAdmin: vi.fn(),
    assertLegacyInteractiveMutationAllowed: vi.fn(async () => {}),
    getCommerceFoundationCutoverState: vi.fn(async () => ({ mode: "LEGACY" })),
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
  applyFoundationSellerQuantitySets: vi.fn(),
  assertFoundationMatrixStructureUnchanged: vi.fn(),
  markFoundationListingSold: vi.fn(),
  endFoundationListing: vi.fn(),
  relistFoundationListing: vi.fn(),
  CommerceFoundationCutoverBlockedError,
  isCommerceFoundationCutoverBlockedError: (err: unknown) =>
    err instanceof CommerceFoundationCutoverBlockedError,
}));

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi,
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin,
}));

vi.mock("@/lib/seller-activity-log", () => ({
  logSellerActivity: vi.fn(),
}));

const { deleteFeedPostsForSoldItem } = vi.hoisted(() => ({
  deleteFeedPostsForSoldItem: vi.fn(),
}));

vi.mock("@/lib/delete-posts-for-sold-item", () => ({
  deleteFeedPostsForSoldItem,
}));

import { deleteEndedListingsPastRetention } from "./ended-listing-cleanup";
import { endStoreItemListing } from "./end-store-item-listing";
import { DELETE as sellerDelete } from "@/app/api/store-items/[id]/route";
import { DELETE as bulkDelete } from "@/app/api/store-items/bulk/route";
import { DELETE as adminDelete } from "@/app/api/admin/store-items/[id]/route";

const sellerId = "seller-1";
const otherId = "seller-2";
const itemId = "item-1";
const now = new Date("2026-09-17T00:00:00.000Z");

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: itemId,
    memberId: sellerId,
    title: "Test listing",
    priceCents: 1000,
    quantity: 4,
    status: "active",
    endedAt: null,
    ...overrides,
  };
}

describe("storeItemStatusWrite lifecycle", () => {
  it("I. sold_out stays distinct from end/inactive", () => {
    expect(storeItemStatusWrite("sold_out", "active")).toEqual({ status: "sold_out" });
    expect(storeItemStatusWrite("inactive", "active", now)).toEqual({
      status: "inactive",
      endedAt: now,
    });
  });

  it("H. relist after End clears endedAt", () => {
    expect(storeItemStatusWrite("active", "inactive")).toEqual({ status: "active", endedAt: null });
  });
});

describe("endStoreItemListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    assertLegacyInteractiveMutationAllowed.mockResolvedValue(undefined);
    mockPrisma.storeItem.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...listing(),
      ...data,
    }));
  });

  it("A. ends a listing without destroying the row or quantity", async () => {
    const result = await endStoreItemListing({ id: itemId, status: "active" });
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: expect.objectContaining({ status: "inactive", endedAt: expect.any(Date) }),
    });
    expect(result.status).toBe("inactive");
  });
});

describe("DELETE /api/store-items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    getSessionForApi.mockResolvedValue({ user: { id: sellerId } });
    requireAdmin.mockResolvedValue(false);
    assertLegacyInteractiveMutationAllowed.mockResolvedValue(undefined);
    mockPrisma.storeItem.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...listing(),
      ...data,
    }));
  });

  it("A. seller DELETE own StoreItem returns ok and ends the row", async () => {
    mockPrisma.storeItem.findUnique.mockResolvedValue(listing());
    const res = await sellerDelete(new NextRequest("http://localhost/api/store-items/item-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: expect.objectContaining({ status: "inactive" }),
    });
    expect(deleteFeedPostsForSoldItem).not.toHaveBeenCalled();
  });

  it("FROZEN seller DELETE returns 503 inventory_cutover_frozen without mutating", async () => {
    mockPrisma.storeItem.findUnique.mockResolvedValue(listing());
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FROZEN" });
    const res = await sellerDelete(new NextRequest("http://localhost/api/store-items/item-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "inventory_cutover_frozen", retryable: true });
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
  });

  it("H. seller DELETE does not destroy feed posts or other durable children", async () => {
    mockPrisma.storeItem.findUnique.mockResolvedValue(listing());
    const res = await sellerDelete(new NextRequest("http://localhost/api/store-items/item-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(200);
    expect(deleteFeedPostsForSoldItem).not.toHaveBeenCalled();
    expect(mockPrisma.orderItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
  });

  it("B. seller cannot end another seller's StoreItem", async () => {
    mockPrisma.storeItem.findUnique.mockResolvedValue(listing({ memberId: otherId }));
    const res = await sellerDelete(new NextRequest("http://localhost/api/store-items/item-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(403);
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
  });

  it("C/J. StoreItem with OrderItem is not deleted", async () => {
    mockPrisma.storeItem.findUnique.mockResolvedValue(listing());
    mockPrisma.orderItem.findMany.mockResolvedValue([{ id: "oi-1", storeItemId: itemId }]);
    const res = await sellerDelete(new NextRequest("http://localhost/api/store-items/item-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
    expect(mockPrisma.orderItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/store-items/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    getSessionForApi.mockResolvedValue({ user: { id: sellerId } });
    mockPrisma.storeItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({
      ...listing({ id: where.id }),
      ...data,
    }));
    mockPrisma.bulkEditSnapshot.create.mockResolvedValue({ id: "snap-1" });
  });

  it("D. bulk DELETE ends owned listings and keeps rows", async () => {
    mockPrisma.storeItem.findMany.mockResolvedValue([listing(), listing({ id: "item-2" })]);
    const req = new NextRequest("http://localhost/api/store-items/bulk", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeItemIds: [itemId, "item-2", "missing"] }),
    });
    const res = await bulkDelete(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(2);
    expect(body.notFound).toBe(1);
    expect(mockPrisma.storeItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).toHaveBeenCalledTimes(2);
  });

  it("E. bulk cannot affect another seller's listing", async () => {
    mockPrisma.storeItem.findMany.mockResolvedValue([]);
    const req = new NextRequest("http://localhost/api/store-items/bulk", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeItemIds: ["foreign-item"] }),
    });
    const res = await bulkDelete(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0, errors: [] });
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["foreign-item"] }, memberId: sellerId },
      })
    );
  });
});

describe("DELETE /api/admin/store-items/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    requireAdmin.mockResolvedValue(true);
    mockPrisma.storeItem.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...listing(),
      ...data,
    }));
  });

  it("F. admin DELETE ends listing rather than destroying the row", async () => {
    mockPrisma.storeItem.findUnique.mockResolvedValue(listing());
    const res = await adminDelete(
      new NextRequest("http://localhost/api/admin/store-items/item-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: itemId }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: expect.objectContaining({ status: "inactive" }),
    });
  });
});

describe("cron ended-listing cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("G. does not physically purge an old ended StoreItem", async () => {
    const result = await deleteEndedListingsPastRetention(new Date("2026-12-01T00:00:00.000Z"));
    expect(result).toEqual({ deleted: 0, skipped: true });
    expect(mockPrisma.storeItem.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
  });
});
