import { describe, expect, it } from "vitest";
import {
  inboundContentFanoutKind,
  isEbayListingEnded,
  mergeConflictDetails,
  readRemoteCatalogState,
  shouldDropStaleChannelRetry,
  shouldSkipEndedEbayOutbound,
  withEbayListingEnded,
  withRemoteCatalogState,
  isRemoteDeletedPending,
  readRemoteDeletedNotice,
  withRemoteDeletedCleared,
  withRemoteDeletedDismissed,
  withRemoteDeletedPending,
} from "./listing-link-flags";

describe("inboundContentFanoutKind", () => {
  it("fans out inventory only when the apply sold the item out", () => {
    expect(inboundContentFanoutKind({ contentChange: true, soldOut: true })).toBe("inventory");
    expect(inboundContentFanoutKind({ contentChange: false, soldOut: true })).toBe("inventory");
  });

  it("fans out sibling content after a non-sale content pull", () => {
    expect(inboundContentFanoutKind({ contentChange: true, soldOut: false })).toBe("content");
  });

  it("does not fan out when nothing changed", () => {
    expect(inboundContentFanoutKind({ contentChange: false, soldOut: false })).toBeNull();
  });
});

describe("ended eBay outbound skip", () => {
  it("skips eBay when the link is marked ended", () => {
    const details = withEbayListingEnded({}, true);
    expect(shouldSkipEndedEbayOutbound("ebay", details)).toBe(true);
    expect(shouldSkipEndedEbayOutbound("etsy", details)).toBe(false);
    expect(shouldSkipEndedEbayOutbound("ebay", {})).toBe(false);
    expect(shouldSkipEndedEbayOutbound("wix", withRemoteDeletedPending({}, "wix"))).toBe(true);
    expect(shouldSkipEndedEbayOutbound("wix", withRemoteDeletedDismissed(withRemoteDeletedPending({}, "wix")))).toBe(
      true
    );
    expect(shouldSkipEndedEbayOutbound("wix", {})).toBe(false);
  });
});

describe("stale retry drop", () => {
  it("drops retries for a shop that already deleted the listing", () => {
    expect(
      shouldDropStaleChannelRetry({
        provider: "wix",
        retryType: "inventory",
        conflictDetails: withRemoteDeletedPending({}, "wix"),
        storeItemQuantity: 1,
        hasRecentSale: false,
      })
    ).toBe(true);
  });

  it("drops eBay retries once the listing is ended", () => {
    expect(
      shouldDropStaleChannelRetry({
        provider: "ebay",
        retryType: "inventory",
        conflictDetails: withEbayListingEnded({}, true),
        storeItemQuantity: 0,
        hasRecentSale: true,
      })
    ).toBe(true);
  });

  it("drops Etsy qty-0 retries after deactivate or recovery, but keeps them after a sale", () => {
    expect(
      shouldDropStaleChannelRetry({
        provider: "etsy",
        retryType: "inventory",
        conflictDetails: withRemoteCatalogState({}, "inactive"),
        storeItemQuantity: 0,
        hasRecentSale: true,
      })
    ).toBe(true);
    expect(
      shouldDropStaleChannelRetry({
        provider: "etsy",
        retryType: "inventory",
        conflictDetails: {},
        storeItemQuantity: 1,
        hasRecentSale: false,
        lastError: "Etsy inventory verify failed: expected 0, got 1",
      })
    ).toBe(true);
    expect(
      shouldDropStaleChannelRetry({
        provider: "etsy",
        retryType: "inventory",
        conflictDetails: {},
        storeItemQuantity: 1,
        hasRecentSale: false,
        lastError: "Etsy inventory verify failed: expected 3, got 2",
      })
    ).toBe(false);
    expect(
      shouldDropStaleChannelRetry({
        provider: "etsy",
        retryType: "inventory",
        conflictDetails: {},
        storeItemQuantity: 0,
        hasRecentSale: false,
      })
    ).toBe(true);
    expect(
      shouldDropStaleChannelRetry({
        provider: "etsy",
        retryType: "inventory",
        conflictDetails: {},
        storeItemQuantity: 0,
        hasRecentSale: true,
      })
    ).toBe(false);
  });
});

describe("ebayListingEnded flag", () => {
  it("stores and clears ebayListingEnded without dropping other keys", () => {
    const withEnded = withEbayListingEnded({ other: 1 }, true);
    expect(isEbayListingEnded(withEnded)).toBe(true);
    expect((withEnded as { other: number }).other).toBe(1);
    expect(isEbayListingEnded(withEbayListingEnded(withEnded, false))).toBe(false);
  });
});

describe("remoteCatalogState", () => {
  it("round-trips skip-sell-out states", () => {
    const stored = withRemoteCatalogState({ ebayPendingInbound: { hash: "a" } }, "inactive_outside_catalog");
    expect(readRemoteCatalogState(stored)).toBe("inactive_outside_catalog");
    expect(
      (stored as { ebayPendingInbound: { hash: string } }).ebayPendingInbound.hash
    ).toBe("a");
    expect(readRemoteCatalogState(withRemoteCatalogState(stored, null))).toBeNull();
  });

  it("reads a remote-delete notice stored as a JSON string", () => {
    const pending = withRemoteDeletedPending({}, "wix", "2026-08-31T00:00:00.000Z");
    expect(isRemoteDeletedPending(JSON.stringify(pending))).toBe(true);
  });

  it("flags a pending remote delete once and keeps it dismissed", () => {
    const pending = withRemoteDeletedPending({ ebayListingEnded: true }, "ebay", "2026-08-31T00:00:00.000Z");
    expect(isRemoteDeletedPending(pending)).toBe(true);
    expect(readRemoteDeletedNotice(pending)?.provider).toBe("ebay");
    expect(isRemoteDeletedPending(withRemoteDeletedPending(pending, "etsy"))).toBe(true);
    expect(readRemoteDeletedNotice(withRemoteDeletedPending(pending, "etsy"))?.provider).toBe("ebay");
    const dismissed = withRemoteDeletedDismissed(pending, "2026-08-31T01:00:00.000Z");
    expect(isRemoteDeletedPending(dismissed)).toBe(false);
    expect(readRemoteDeletedNotice(dismissed)?.dismissedAt).toBe("2026-08-31T01:00:00.000Z");
    expect(readRemoteDeletedNotice(withRemoteDeletedCleared(dismissed))).toBeNull();
  });

  it("merges patches and deletes null keys", () => {
    const merged = mergeConflictDetails({ keep: true, drop: 1 }, { drop: null, add: "x" });
    expect(merged).toEqual({ keep: true, add: "x" });
  });
});
