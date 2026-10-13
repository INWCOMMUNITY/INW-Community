import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    etsyConnection: { findFirst: vi.fn() },
    etsyListingLink: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    etsyVariantMap: { deleteMany: vi.fn() },
    etsySyncJob: { updateMany: vi.fn() },
    storeItem: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        etsyVariantMap: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        etsyListingLink: { delete: vi.fn().mockResolvedValue({}) },
      })
    ),
  },
  ensureEtsyReconcileListingJob: vi.fn(),
  recordEtsyDirtyMappedVariantContentDesires: vi.fn(),
  recordEtsyListingContentDesire: vi.fn(),
  captureEtsyInventoryProjectionDesire: vi.fn(),
  reconcileEtsyListingHealthFromDb: vi.fn(),
  etsyProductContentFingerprint: vi.fn(() => "product-fp"),
}));

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

vi.mock("./create-listing", () => ({
  etsyCreateListingDedupeKey: (connectionId: string, storeItemId: string) =>
    `CREATE_LISTING:${connectionId}:${storeItemId}`,
  enqueueEtsyCreateListing: vi.fn(),
}));

import {
  captureEtsyInventoryProjectionDesire,
  ensureEtsyReconcileListingJob,
  prisma,
  reconcileEtsyListingHealthFromDb,
  recordEtsyDirtyMappedVariantContentDesires,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import { enqueueEtsyCreateListing } from "./create-listing";
import { runEtsyListingAction } from "./listing-actions";

describe("runEtsyListingAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findFirst).mockReset();
    vi.mocked(prisma.etsyListingLink.findFirst).mockReset();
    vi.mocked(prisma.etsyListingLink.findUnique).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(prisma.etsySyncJob.updateMany).mockReset();
    vi.mocked(prisma.$transaction).mockClear();
    vi.mocked(etsyConnectionRequest).mockReset();
    vi.mocked(enqueueEtsyCreateListing).mockReset();
    vi.mocked(ensureEtsyReconcileListingJob).mockReset();
    vi.mocked(recordEtsyDirtyMappedVariantContentDesires).mockReset();
    vi.mocked(captureEtsyInventoryProjectionDesire).mockReset();
    vi.mocked(reconcileEtsyListingHealthFromDb).mockReset();

    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopId: "shop-1",
    } as never);
    vi.mocked(prisma.etsyListingLink.findFirst).mockResolvedValue({
      id: "link-1",
      storeItemId: "item-1",
      etsyListingId: "999",
      remoteListingState: "active",
      variantMaps: [{ storeVariantId: "sv-1" }],
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      appliedProductFingerprint: "product-fp",
      lastObservedProductFingerprint: "product-fp",
    } as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      title: "Title",
      description: null,
      priceCents: 100,
      sku: null,
      photos: [],
    } as never);
    vi.mocked(prisma.etsySyncJob.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(ensureEtsyReconcileListingJob).mockResolvedValue({ id: "job-r" } as never);
    vi.mocked(recordEtsyDirtyMappedVariantContentDesires).mockResolvedValue({
      status: "RECORDED",
      dirtyCount: 1,
    } as never);
    vi.mocked(captureEtsyInventoryProjectionDesire).mockResolvedValue({
      status: "RECORDED",
    } as never);
    vi.mocked(reconcileEtsyListingHealthFromDb).mockResolvedValue({
      readiness: "ACTION_REQUIRED",
      issueCode: "CONTENT_SYNC_PENDING",
      issueMessage: "INW changes have not finished syncing to Etsy yet",
    } as never);
  });

  it("unlinks without remote delete when confirmDelete is false", async () => {
    const result = await runEtsyListingAction({
      memberId: "m1",
      storeItemId: "item-1",
      action: "remove",
      confirmDelete: false,
    });
    expect(result).toEqual({
      ok: true,
      message: "Unlinked from Etsy (listing left on Etsy)",
    });
    expect(etsyConnectionRequest).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.etsySyncJob.updateMany).toHaveBeenCalled();
  });

  it("unlinks before remote delete and still succeeds when remote fails", async () => {
    const order: string[] = [];
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push("unlink");
      return fn({
        etsyVariantMap: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        etsyListingLink: { delete: vi.fn().mockResolvedValue({}) },
      });
    });
    vi.mocked(etsyConnectionRequest).mockImplementation(async () => {
      order.push("remote");
      return {
        ok: false,
        class: "PERMANENT",
        httpStatus: 400,
        data: null,
        message: "property ids 100 are deprecated",
        retryAfterMs: null,
        rateLimit: null,
      };
    });
    const result = await runEtsyListingAction({
      memberId: "m1",
      storeItemId: "item-1",
      action: "remove",
      confirmDelete: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("Unlinked in INW");
      expect(result.message).toContain("not deleted");
    }
    expect(order[0]).toBe("unlink");
    expect(order).toContain("remote");
  });

  it("unlinks even when Etsy app config is missing", async () => {
    vi.mocked(etsyConnectionRequest).mockResolvedValue({
      ok: false,
      class: "NOT_CONFIGURED",
      httpStatus: null,
      data: null,
      message: "Etsy is not configured",
      retryAfterMs: null,
      rateLimit: null,
    });
    const result = await runEtsyListingAction({
      memberId: "m1",
      storeItemId: "item-1",
      action: "remove",
      confirmDelete: true,
    });
    expect(result.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("retries create for non-live mappings", async () => {
    vi.mocked(prisma.etsyListingLink.findFirst).mockResolvedValue({
      id: "link-1",
      storeItemId: "item-1",
      etsyListingId: "999",
      remoteListingState: "draft",
      variantMaps: [{ storeVariantId: "sv-1" }],
    } as never);
    vi.mocked(enqueueEtsyCreateListing).mockResolvedValue({
      status: "QUEUED",
      connectionId: "conn-1",
      storeItemId: "item-1",
      jobId: "job-1",
    } as never);
    const result = await runEtsyListingAction({
      memberId: "m1",
      storeItemId: "item-1",
      action: "retry",
    });
    expect(result).toEqual({ ok: true, message: "List on Etsy queued" });
    expect(enqueueEtsyCreateListing).toHaveBeenCalledWith({
      memberId: "m1",
      storeItemId: "item-1",
    });
  });

  it("reload queues reconcile and re-projects content/qty for live listings", async () => {
    const result = await runEtsyListingAction({
      memberId: "m1",
      storeItemId: "item-1",
      action: "reload",
    });
    expect(result).toEqual({ ok: true, message: "Reload queued" });
    expect(ensureEtsyReconcileListingJob).toHaveBeenCalled();
    expect(recordEtsyDirtyMappedVariantContentDesires).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ memberId: "m1", storeItemId: "item-1" })
    );
    expect(captureEtsyInventoryProjectionDesire).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ memberId: "m1", storeVariantId: "sv-1", force: true })
    );
    expect(reconcileEtsyListingHealthFromDb).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ connectionId: "conn-1", listingLinkId: "link-1" })
    );
    expect(enqueueEtsyCreateListing).not.toHaveBeenCalled();
  });

  it("retry on live listings behaves like reload", async () => {
    const result = await runEtsyListingAction({
      memberId: "m1",
      storeItemId: "item-1",
      action: "retry",
    });
    expect(result).toEqual({ ok: true, message: "Reload queued" });
    expect(ensureEtsyReconcileListingJob).toHaveBeenCalled();
    expect(enqueueEtsyCreateListing).not.toHaveBeenCalled();
  });
});
