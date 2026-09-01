import { describe, expect, it, vi, beforeEach } from "vitest";
import { ENDED_LISTING_RETENTION_MS, endOnInwConfirm, endOnInwResult, hasLinkedChannelListings, storeItemStatusWrite } from "./store-item-ended-status";

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

describe("hasLinkedChannelListings", () => {
  it("is true when any selected item is listed on a 3rd party", () => {
    expect(hasLinkedChannelListings([{ channelLinks: [{ provider: "wix" }] }])).toBe(true);
    expect(hasLinkedChannelListings([{ channelLinks: [] }, { channelLinks: [{ provider: "ebay" }] }])).toBe(true);
  });

  it("is false when listings are only on INW", () => {
    expect(hasLinkedChannelListings([{ channelLinks: [] }])).toBe(false);
    expect(hasLinkedChannelListings([{}])).toBe(false);
  });

  it("is false when leftover shop links were already deleted there", () => {
    expect(
      hasLinkedChannelListings([
        { channelLinks: [{ provider: "wix", remoteDeletedProvider: "wix" }] },
      ])
    ).toBe(false);
  });
});

describe("endOnInw copy", () => {
  it("names Wix in the confirm and success heads-up", () => {
    expect(endOnInwConfirm(1, ["Wix"])).toMatch(/will NOT end this listing on Wix/i);
    const result = endOnInwResult(1, 0, ["Wix"]);
    expect(result.title).toBe("Off INW Only");
    expect(result.message).toMatch(/did not take it down on Wix/i);
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
