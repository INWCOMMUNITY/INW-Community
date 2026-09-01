import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, publishStoreItemToChannels, unpublishStoreItemFromChannels } = vi.hoisted(() => ({
  mockPrisma: {
    storeItem: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    channelListingLink: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
  publishStoreItemToChannels: vi.fn(),
  unpublishStoreItemFromChannels: vi.fn(),
}));

vi.mock("database", () => ({
  prisma: mockPrisma,
  Prisma: { JsonNull: { $type: "JsonNull" } },
}));

vi.mock("@/lib/channels/outbound", () => ({
  publishStoreItemToChannels: (...args: unknown[]) => publishStoreItemToChannels(...args),
  unpublishStoreItemFromChannels: (...args: unknown[]) => unpublishStoreItemFromChannels(...args),
}));

vi.mock("@/lib/seller-activity-log", () => ({
  logSellerActivity: vi.fn(),
}));

import { applyBulkDestinations } from "./store-item-apply-bulk-destinations";

function ownedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "a",
    status: "active",
    channelLinks: [
      { provider: "ebay", syncEnabled: true, conflictDetails: {} },
      { provider: "wix", syncEnabled: true, conflictDetails: {} },
    ],
    ...overrides,
  };
}

describe("applyBulkDestinations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.storeItem.findMany.mockResolvedValue([ownedItem()]);
    publishStoreItemToChannels.mockResolvedValue([{ provider: "etsy", ok: true }]);
    unpublishStoreItemFromChannels.mockResolvedValue([{ provider: "ebay", ok: true }]);
  });

  it("publishes missing stores and unpublishes unchecked live stores", async () => {
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "sync",
      assignments: [{ storeItemId: "a", inw: true, providers: ["wix", "etsy"] }],
    });
    expect(unpublishStoreItemFromChannels).toHaveBeenCalledWith("a", ["ebay"]);
    expect(publishStoreItemToChannels).toHaveBeenCalledWith("a", "m1", { providers: ["etsy"] });
    expect(result.published).toBe(1);
    expect(result.unpublished).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("ends INW only without touching spared channels", async () => {
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "end",
      assignments: [{ storeItemId: "a", inw: true, providers: [] }],
    });
    expect(unpublishStoreItemFromChannels).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { status: "inactive", endedAt: expect.any(Date) },
    });
    expect(result.ended).toBe(1);
  });

  it("ends a channel without ending INW", async () => {
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "end",
      assignments: [{ storeItemId: "a", inw: false, providers: ["ebay"] }],
    });
    expect(unpublishStoreItemFromChannels).toHaveBeenCalledWith("a", ["ebay"]);
    expect(mockPrisma.storeItem.update).not.toHaveBeenCalled();
    expect(result.ended).toBe(0);
    expect(result.unpublished).toBe(1);
  });

  it("does not delete INW when a selected channel delete fails", async () => {
    unpublishStoreItemFromChannels.mockResolvedValueOnce([
      { provider: "ebay", ok: false, error: "eBay timeout" },
    ]);
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "delete",
      assignments: [{ storeItemId: "a", inw: true, providers: ["ebay"] }],
    });
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].detail).toMatch(/not deleted/i);
  });

  it("unsyncs INW by ending the storefront listing and disabling qty sync on leftover links", async () => {
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "sync",
      assignments: [{ storeItemId: "a", inw: false, providers: ["ebay", "wix"] }],
    });
    expect(unpublishStoreItemFromChannels).not.toHaveBeenCalled();
    expect(mockPrisma.storeItem.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { status: "inactive", endedAt: expect.any(Date) },
    });
    expect(mockPrisma.channelListingLink.updateMany).toHaveBeenCalledWith({
      where: { storeItemId: "a", provider: { in: ["ebay", "wix"] } },
      data: { syncEnabled: false },
    });
    expect(result.unsyncedInw).toBe(1);
  });

  it("treats a remotely deleted store as unlisted so Save does not delete it again", async () => {
    mockPrisma.storeItem.findMany.mockResolvedValueOnce([
      ownedItem({
        channelLinks: [
          { provider: "ebay", syncEnabled: true, conflictDetails: {} },
          {
            provider: "wix",
            syncEnabled: true,
            conflictDetails: {
              remoteDeleted: { provider: "wix", detectedAt: "2026-08-31T00:00:00.000Z" },
            },
          },
        ],
      }),
    ]);
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "sync",
      assignments: [{ storeItemId: "a", inw: true, providers: ["ebay"] }],
    });
    expect(unpublishStoreItemFromChannels).not.toHaveBeenCalled();
    expect(publishStoreItemToChannels).not.toHaveBeenCalled();
    expect(result.published).toBe(0);
    expect(result.unpublished).toBe(0);
  });

  it("relists a remotely deleted store when that box is checked", async () => {
    mockPrisma.storeItem.findMany.mockResolvedValueOnce([
      ownedItem({
        channelLinks: [
          { provider: "ebay", syncEnabled: true, conflictDetails: {} },
          {
            provider: "wix",
            syncEnabled: true,
            conflictDetails: {
              remoteDeleted: { provider: "wix", detectedAt: "2026-08-31T00:00:00.000Z" },
            },
          },
        ],
      }),
    ]);
    publishStoreItemToChannels.mockResolvedValueOnce([{ provider: "wix", ok: true }]);
    const result = await applyBulkDestinations({
      memberId: "m1",
      action: "sync",
      assignments: [{ storeItemId: "a", inw: true, providers: ["ebay", "wix"] }],
    });
    expect(unpublishStoreItemFromChannels).not.toHaveBeenCalled();
    expect(publishStoreItemToChannels).toHaveBeenCalledWith("a", "m1", { providers: ["wix"] });
    expect(result.published).toBe(1);
  });
});
