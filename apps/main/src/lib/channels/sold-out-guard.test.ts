import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  channelSyncEvent: {
    findFirst: vi.fn(),
  },
  channelListingLink: {
    findFirst: vi.fn(),
  },
}));

vi.mock("database", () => ({ prisma: mockPrisma }));

import { isSoldOutQtyRecovery, shouldBlockSoldOutQtyRecovery, shouldPushSoldOutInventoryOnly } from "./sold-out-guard";

describe("isSoldOutQtyRecovery", () => {
  it("is recovery when INW is empty and the channel still has stock", () => {
    expect(isSoldOutQtyRecovery(0, "sold_out", 3)).toBe(true);
    expect(isSoldOutQtyRecovery(0, "active", 1)).toBe(true);
  });

  it("is not recovery when applying zero or when INW still has stock", () => {
    expect(isSoldOutQtyRecovery(0, "sold_out", 0)).toBe(false);
    expect(isSoldOutQtyRecovery(2, "active", 5)).toBe(false);
  });
});

describe("shouldBlockSoldOutQtyRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.channelSyncEvent.findFirst.mockResolvedValue(null);
    mockPrisma.channelListingLink.findFirst.mockResolvedValue(null);
  });

  it("blocks when a sale event exists in the lookback window", async () => {
    mockPrisma.channelSyncEvent.findFirst.mockResolvedValueOnce({ id: "evt-1" });
    await expect(shouldBlockSoldOutQtyRecovery("item-1")).resolves.toBe(true);
  });

  it("does not treat a failed channel push as a sale", async () => {
    mockPrisma.channelListingLink.findFirst.mockResolvedValueOnce({ id: "link-1" });
    await expect(shouldBlockSoldOutQtyRecovery("item-1")).resolves.toBe(false);
  });

  it("allows recovery when there is no sale and no failed push", async () => {
    await expect(shouldBlockSoldOutQtyRecovery("item-1")).resolves.toBe(false);
  });
});

describe("shouldPushSoldOutInventoryOnly", () => {
  it("uses inventory-only when qty changed but lastPushedHash still matches", () => {
    expect(
      shouldPushSoldOutInventoryOnly({
        quantity: 0,
        status: "sold_out",
        contentUnchanged: true,
        inventoryDrift: true,
        syncBaselineHash: "content",
        contentHashNow: "content",
      })
    ).toBe(true);
  });

  it("uses inventory-only after a sale when title/photos/price did not change", () => {
    expect(
      shouldPushSoldOutInventoryOnly({
        quantity: 0,
        status: "sold_out",
        contentUnchanged: false,
        inventoryDrift: true,
        syncBaselineHash: "title-photos-price",
        contentHashNow: "title-photos-price",
      })
    ).toBe(true);
  });

  it("does not skip content update when the seller edited title or photos", () => {
    expect(
      shouldPushSoldOutInventoryOnly({
        quantity: 0,
        status: "sold_out",
        contentUnchanged: false,
        inventoryDrift: true,
        syncBaselineHash: "old-content",
        contentHashNow: "new-title",
      })
    ).toBe(false);
  });
});
