import { describe, expect, it, vi, beforeEach } from "vitest";
import { storeItemStatusWrite } from "./store-item-ended-status";

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

  it("does not treat sold_out as ending", () => {
    expect(storeItemStatusWrite("sold_out", "active")).toEqual({ status: "sold_out" });
  });
});

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

describe("endedListingPurgeWhere", () => {
  it("documents the historical purge filter (no longer executed)", () => {
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
  });

  it("does not physically delete StoreItems", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const result = await deleteEndedListingsPastRetention(now);
    expect(result).toEqual({ deleted: 0, skipped: true });
    expect(mockPrisma.storeItem.deleteMany).not.toHaveBeenCalled();
  });
});
