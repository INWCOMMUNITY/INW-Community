import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    etsyConnection: { findFirst: vi.fn() },
    etsyListingLink: { findFirst: vi.fn(), delete: vi.fn() },
    etsyVariantMap: { deleteMany: vi.fn() },
    etsySyncJob: { updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        etsyVariantMap: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        etsyListingLink: { delete: vi.fn().mockResolvedValue({}) },
      })
    ),
  },
}));

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

vi.mock("./create-listing", () => ({
  etsyCreateListingDedupeKey: (connectionId: string, storeItemId: string) =>
    `CREATE_LISTING:${connectionId}:${storeItemId}`,
  enqueueEtsyCreateListing: vi.fn(),
}));

import { prisma } from "database";
import { etsyConnectionRequest } from "./connection-request";
import { enqueueEtsyCreateListing } from "./create-listing";
import { runEtsyListingAction } from "./listing-actions";

describe("runEtsyListingAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findFirst).mockReset();
    vi.mocked(prisma.etsyListingLink.findFirst).mockReset();
    vi.mocked(prisma.etsySyncJob.updateMany).mockReset();
    vi.mocked(prisma.$transaction).mockClear();
    vi.mocked(etsyConnectionRequest).mockReset();
    vi.mocked(enqueueEtsyCreateListing).mockReset();

    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopId: "shop-1",
    } as never);
    vi.mocked(prisma.etsyListingLink.findFirst).mockResolvedValue({
      id: "link-1",
      storeItemId: "item-1",
      etsyListingId: "999",
      remoteListingState: "draft",
    } as never);
    vi.mocked(prisma.etsySyncJob.updateMany).mockResolvedValue({ count: 1 } as never);
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

  it("deletes remote listing then unlinks when confirmDelete is true", async () => {
    vi.mocked(etsyConnectionRequest).mockResolvedValue({
      ok: true,
      class: "SUCCESS",
      httpStatus: 204,
      data: null,
      message: "",
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
    expect(etsyConnectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/listings/999",
      })
    );
  });

  it("retries create for non-live mappings", async () => {
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
});
