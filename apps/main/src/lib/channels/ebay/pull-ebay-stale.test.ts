import { describe, expect, it } from "vitest";
import { ebayGetItemIsStaleVersusInw, isEbayInboundContentChange, ebayGetItemDetailsAreUsable } from "./pull-ebay-updates";

describe("isEbayInboundContentChange", () => {
  it("treats ebayCategoryId-only writes as metadata, not inbound content", () => {
    expect(isEbayInboundContentChange({ ebayCategoryId: 36059 })).toBe(false);
    expect(isEbayInboundContentChange({ ebayCategoryId: 36059, category: "Collectibles" })).toBe(
      false
    );
  });

  it("treats title/price/qty writes as inbound content", () => {
    expect(isEbayInboundContentChange({ title: "EBAY CRON TEST 4" })).toBe(true);
    expect(isEbayInboundContentChange({ priceCents: 4400, ebayCategoryId: 36059 })).toBe(true);
    expect(isEbayInboundContentChange({ quantity: 4 })).toBe(true);
  });
});

describe("ebayGetItemDetailsAreUsable", () => {
  it("rejects an empty GetItem failure payload", () => {
    expect(
      ebayGetItemDetailsAreUsable({ title: null, priceCents: null, quantity: null })
    ).toBe(false);
  });

  it("accepts a listing that has any of title, price, or qty", () => {
    expect(
      ebayGetItemDetailsAreUsable({ title: "EBAY CRON TEST 4", priceCents: null, quantity: null })
    ).toBe(true);
    expect(
      ebayGetItemDetailsAreUsable({ title: null, priceCents: 4400, quantity: null })
    ).toBe(true);
  });
});

describe("ebayGetItemIsStaleVersusInw", () => {
  const now = new Date("2026-08-20T05:05:50.000Z");
  const refreshedAt = new Date("2026-08-20T05:04:20.000Z");

  it("skips a lagged GetItem with no last-modified right after an INW refresh", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now,
      })
    ).toBe(true);
  });

  it("applies GetItem when eBay was revised after the INW refresh", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:05:00.000Z"),
        now,
      })
    ).toBe(false);
  });

  it("still skips a lagged GetItem 5 minutes later when LastModified is missing", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(true);
  });

  it("never applies GetItem when LastModified is missing, even 15 minutes later", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now: new Date("2026-08-20T05:20:00.000Z"),
      })
    ).toBe(true);
  });

  it("never applies a GetItem whose LastModified is older than the last inbound pull", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:03:00.000Z"),
        now: new Date("2026-08-20T05:25:00.000Z"),
      })
    ).toBe(true);
  });

  it("applies the first GetItem when INW has never pulled or pushed", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: null,
        lastPushedAt: null,
        inwUpdatedAt: null,
        ebayLastModified: null,
        now,
      })
    ).toBe(false);
  });

  it("skips GetItem that is only an echo of our own inventory push", () => {
    const pushedAt = new Date("2026-08-20T05:06:00.000Z");
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        lastPushedAt: pushedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:06:01.000Z"),
        now: new Date("2026-08-20T05:06:10.000Z"),
      })
    ).toBe(true);
  });

  it("skips an older eBay snapshot after the seller saves on INW", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: new Date("2026-08-20T05:04:20.000Z"),
        lastPushedAt: new Date("2026-08-20T05:06:00.000Z"),
        inwUpdatedAt: new Date("2026-08-20T05:05:59.000Z"),
        ebayLastModified: new Date("2026-08-20T05:04:00.000Z"),
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(true);
  });

  it("skips a lagged TEST 5 replica after a successful inbound of the live listing", () => {
    const pulledAt = new Date("2026-08-20T05:04:20.000Z");
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: pulledAt,
        lastAppliedRemoteAt: new Date("2026-08-20T05:04:00.000Z"),
        inwUpdatedAt: pulledAt,
        ebayLastModified: new Date("2026-08-20T04:50:00.000Z"),
        now: new Date("2026-08-20T05:20:00.000Z"),
      })
    ).toBe(true);
  });

  it("applies GetItem when LastModified is newer than inbound, push, and INW save", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        lastPushedAt: new Date("2026-08-20T05:06:00.000Z"),
        inwUpdatedAt: new Date("2026-08-20T05:05:59.000Z"),
        ebayLastModified: new Date("2026-08-20T05:07:00.000Z"),
        now: new Date("2026-08-20T05:07:10.000Z"),
      })
    ).toBe(false);
  });
});
