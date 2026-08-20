import { describe, expect, it } from "vitest";
import { ebayGetItemIsStaleVersusInw } from "./pull-ebay-updates";

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
