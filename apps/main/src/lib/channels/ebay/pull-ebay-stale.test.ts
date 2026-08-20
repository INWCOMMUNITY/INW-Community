import { describe, expect, it } from "vitest";
import { ebayGetItemIsStaleVersusInw } from "./pull-ebay-updates";

describe("ebayGetItemIsStaleVersusInw", () => {
  const now = new Date("2026-08-20T05:05:50.000Z");
  const refreshedAt = new Date("2026-08-20T05:04:20.000Z");

  it("skips GetItem for 15 minutes after an INW refresh so a lagged TEST 2 cannot overwrite TEST 3", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        now,
      })
    ).toBe(true);
  });

  it("applies GetItem once the echo window has passed", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        inwUpdatedAt: refreshedAt,
        now: new Date("2026-08-20T05:20:00.000Z"),
      })
    ).toBe(false);
  });

  it("applies GetItem when there has been no recent inbound", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: new Date("2026-08-19T00:00:00.000Z"),
        inwUpdatedAt: new Date("2026-08-19T00:00:00.000Z"),
        now,
      })
    ).toBe(false);
  });
});
