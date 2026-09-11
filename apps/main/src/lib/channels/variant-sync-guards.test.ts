import { describe, expect, it } from "vitest";
import {
  readLastPushedVariantPricesHash,
  withLastPushedVariantPricesHash,
  readEtsyLastSyncedContent,
  withEtsyLastSyncedContent,
  readLastInventoryPushAt,
  withLastInventoryPushAt,
} from "./listing-conflict-json";
import {
  readEbayPendingVariantInboundHash,
  withEbayPendingVariantInbound,
} from "./ebay/pull-ebay-updates";

describe("lastPushedVariantPricesHash conflictDetails helpers", () => {
  it("round-trips a hash and preserves other keys", () => {
    const cd = withLastPushedVariantPricesHash({ ebayLastSyncedTitle: "keep" }, "abc123");
    expect(readLastPushedVariantPricesHash(cd)).toBe("abc123");
    expect((cd as Record<string, unknown>).ebayLastSyncedTitle).toBe("keep");
  });

  it("returns null when unset and clears on null/empty", () => {
    expect(readLastPushedVariantPricesHash(null)).toBeNull();
    expect(readLastPushedVariantPricesHash({})).toBeNull();
    const cleared = withLastPushedVariantPricesHash({ lastPushedVariantPricesHash: "x" }, null);
    expect(readLastPushedVariantPricesHash(cleared)).toBeNull();
    const clearedEmpty = withLastPushedVariantPricesHash({ lastPushedVariantPricesHash: "x" }, "  ");
    expect(readLastPushedVariantPricesHash(clearedEmpty)).toBeNull();
  });
});

describe("etsyLastSyncedContent conflictDetails helpers", () => {
  it("round-trips title + price and detects an independent Etsy edit", () => {
    const cd = withEtsyLastSyncedContent({}, { title: "INW Title", priceCents: 5000 });
    const baseline = readEtsyLastSyncedContent(cd);
    expect(baseline.title).toBe("INW Title");
    expect(baseline.priceCents).toBe(5000);
    // Live Etsy still equals the baseline -> not independently edited.
    expect(baseline.title === "INW Title" && baseline.priceCents === 5000).toBe(true);
  });

  it("returns nulls when unset", () => {
    const baseline = readEtsyLastSyncedContent(null);
    expect(baseline.title).toBeNull();
    expect(baseline.priceCents).toBeNull();
  });
});

describe("ebayPendingVariantInbound two-look helpers", () => {
  it("round-trips a pending variant snapshot hash and clears on null", () => {
    const cd = withEbayPendingVariantInbound({ ebayPendingInbound: { hash: "content", seenAt: "t" } }, {
      hash: "variantsnap",
      seenAt: new Date().toISOString(),
    });
    expect(readEbayPendingVariantInboundHash(cd)).toBe("variantsnap");
    // Independent from the content pending marker.
    expect((cd as Record<string, unknown>).ebayPendingInbound).toBeTruthy();
    const cleared = withEbayPendingVariantInbound(cd, null);
    expect(readEbayPendingVariantInboundHash(cleared)).toBeNull();
  });

  it("returns null when unset", () => {
    expect(readEbayPendingVariantInboundHash(null)).toBeNull();
    expect(readEbayPendingVariantInboundHash({})).toBeNull();
  });
});

describe("lastInventoryPushAt conflictDetails helpers", () => {
  it("round-trips a Date and preserves other keys", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const cd = withLastInventoryPushAt({ ebayListingEnded: true }, now);
    const read = readLastInventoryPushAt(cd);
    expect(read).toBeInstanceOf(Date);
    expect(read!.toISOString()).toBe(now.toISOString());
    expect((cd as Record<string, unknown>).ebayListingEnded).toBe(true);
  });

  it("returns null when unset or invalid", () => {
    expect(readLastInventoryPushAt(null)).toBeNull();
    expect(readLastInventoryPushAt({})).toBeNull();
    expect(readLastInventoryPushAt({ lastInventoryPushAt: "not-a-date" })).toBeNull();
  });
});
