import { describe, expect, it } from "vitest";
import { ebayGetItemIsStaleVersusInw, isEbayInboundContentChange } from "./pull-ebay-updates";

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

  it("applies GetItem once the 5-minute echo window has passed", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        ebayLastModified: null,
        now: new Date("2026-08-20T05:10:00.000Z"),
      })
    ).toBe(false);
  });
});
