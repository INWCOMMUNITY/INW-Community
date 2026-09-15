import { afterEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  channelListingLink: {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
  },
  storeItem: { update: vi.fn() },
}));

vi.mock("database", () => ({ prisma }));

import {
  EBAY_HUB_VIEW_ITEM_COPY_DELAY_MS,
  ebayHubViewItemCopyDecision,
  scheduleEbayHubViewItemCopy,
} from "./hub-view-item";

const now = new Date("2026-09-14T12:00:00.000Z");

describe("ebayHubViewItemCopyDecision", () => {
  it("copies when Hub listed remaining disagrees with View Item and INW stock is unchanged", () => {
    expect(
      ebayHubViewItemCopyDecision({
        hubQty: 5,
        viewQty: 1,
        inwQty: 1,
        baselineQty: 1,
        lastPushedAt: new Date("2026-09-14T11:00:00.000Z"),
        now,
      })
    ).toBe("copy");
  });

  it("copies when there is no baseline (leftover / unbaselined leftover attach)", () => {
    expect(
      ebayHubViewItemCopyDecision({
        hubQty: 5,
        viewQty: 1,
        inwQty: 1,
        baselineQty: null,
        lastPushedAt: null,
        now,
      })
    ).toBe("copy");
  });

  it("skips when INW qty drifted from baseline", () => {
    expect(
      ebayHubViewItemCopyDecision({
        hubQty: 5,
        viewQty: 1,
        inwQty: 8,
        baselineQty: 1,
        lastPushedAt: new Date("2026-09-14T11:00:00.000Z"),
        now,
      })
    ).toBe("skip_inw_changed");
  });

  it("skips when Hub listed remaining already matches View Item", () => {
    expect(
      ebayHubViewItemCopyDecision({
        hubQty: 5,
        viewQty: 5,
        inwQty: 1,
        baselineQty: 1,
        lastPushedAt: null,
        now,
      })
    ).toBe("skip_already_live");
  });

  it("skips during the INW push echo window", () => {
    expect(
      ebayHubViewItemCopyDecision({
        hubQty: 5,
        viewQty: 1,
        inwQty: 1,
        baselineQty: 1,
        lastPushedAt: new Date("2026-09-14T11:59:00.000Z"),
        now,
      })
    ).toBe("skip_echo");
  });

  it("skips when Hub listed remaining is unknown", () => {
    expect(
      ebayHubViewItemCopyDecision({
        hubQty: null,
        viewQty: 1,
        inwQty: 1,
        baselineQty: 1,
        lastPushedAt: null,
        now,
      })
    ).toBe("skip_no_hub");
  });
});

describe("scheduleEbayHubViewItemCopy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for Hub Revise to settle before looking up the listing", async () => {
    vi.useFakeTimers();
    prisma.channelListingLink.findFirst.mockClear();
    const pending = scheduleEbayHubViewItemCopy("403004607151");
    await vi.advanceTimersByTimeAsync(EBAY_HUB_VIEW_ITEM_COPY_DELAY_MS - 1);
    expect(prisma.channelListingLink.findFirst).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ copied: false, reason: "skip_no_sku" });
    expect(prisma.channelListingLink.findFirst).toHaveBeenCalled();
  });
});
