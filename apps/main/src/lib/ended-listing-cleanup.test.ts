import { describe, expect, it, vi, beforeEach } from "vitest";
import { ENDED_LISTING_RETENTION_MS, storeItemStatusWrite } from "./store-item-ended-status";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    storeItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  },
}));

vi.mock("database", () => ({
  prisma: mockPrisma,
}));

import { deleteEndedListingsPastRetention, endedListingPurgeWhere } from "./ended-listing-cleanup";

describe("storeItemStatusWrite", () => {
  it("stamps endedAt when a listing is ended", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(storeItemStatusWrite("inactive", "active", now)).toEqual({
      status: "inactive",
      endedAt: now,
    });
  });

  it("does not reset the 14-day clock if already ended", () => {
    expect(storeItemStatusWrite("inactive", "inactive")).toEqual({ status: "inactive" });
  });

  it("clears endedAt on relist", () => {
    expect(storeItemStatusWrite("active", "inactive")).toEqual({ status: "active", endedAt: null });
  });
});

describe("endedListingPurgeWhere", () => {
  it("selects ended INW records past cutoff without order or offer history", () => {
    const cutoff = new Date("2026-08-11T12:00:00.000Z");
    expect(endedListingPurgeWhere(cutoff)).toEqual({
      status: "inactive",
      endedAt: { lte: cutoff },
      orderItems: { none: {} },
      resaleOffers: { none: {} },
    });
  });
});

describe("deleteEndedListingsPastRetention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.storeItem.deleteMany.mockResolvedValue({ count: 2 });
  });

  it("deletes INW rows older than 14 days and does not call channel APIs", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const { deleted } = await deleteEndedListingsPastRetention(now);
    expect(deleted).toBe(2);
    expect(mockPrisma.storeItem.deleteMany).toHaveBeenCalledWith({
      where: endedListingPurgeWhere(new Date(now.getTime() - ENDED_LISTING_RETENTION_MS)),
    });
  });
});
