import { describe, expect, it } from "vitest";
import {
  ebayGetItemIsStaleVersusInw,
  ebayGetItemApplyDecision,
  ebayGetItemEndedDecision,
  ebayGetItemShouldPreserveInwContent,
  ebayGetItemContentApplyLinkData,
  isEbayInboundContentChange,
  ebayGetItemDetailsAreUsable,
  readEbayPendingInboundHash,
  shouldApplyEbayInboundVariants,
  ebayGetItemShouldApplyListingQuantity,
  withEbayPendingInbound,
  ebayCronShouldRetryOutbound,
  ebayCronShouldPushOutbound,
  ebayDirtyInboundUnconfirmed,
  withEbayDirtyUnconfirmed,
  EBAY_DIRTY_UNCONFIRMED_TTL_MS,
  ebayInPostInboundSettleWindow,
  EBAY_POST_INBOUND_SETTLE_MS,
} from "./pull-ebay-updates";

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

  it("stamps lastInboundAt and synced status on GetItem content apply", () => {
    const now = new Date("2026-09-10T02:30:30.201Z");
    const patch = ebayGetItemContentApplyLinkData({
      contentHash: "abc",
      metaHash: "def",
      variantsHash: "ghi",
      quantity: 4,
      remoteUpdatedAt: null,
      conflictDetails: {},
      remoteTitle: "Vintage Bear Clock (Testing) Sync Ebay",
      now,
    });
    expect(patch.lastInboundAt).toEqual(now);
    expect(patch.syncStatus).toBe("synced");
    expect(patch.syncError).toBeNull();
  });

  it("does not rewrite last-synced title on a qty-only GetItem apply", () => {
    const patch = ebayGetItemContentApplyLinkData({
      contentHash: "abc",
      metaHash: "def",
      variantsHash: "ghi",
      quantity: 3,
      remoteUpdatedAt: null,
      conflictDetails: { ebayLastSyncedTitle: "INW Title" },
      remoteTitle: "Lagged eBay Title",
      titleApplied: false,
    });
    expect(patch.lastInboundAt).toBeInstanceOf(Date);
    expect(patch.syncBaselineQty).toBe(3);
    expect(
      (patch.conflictDetails as { ebayLastSyncedTitle?: string }).ebayLastSyncedTitle
    ).toBe("INW Title");
  });

  it("maps a GetItem title/photos/description apply to sibling content fan-out", async () => {
    const { inboundContentFanoutKind } = await import("../listing-link-flags");
    expect(
      isEbayInboundContentChange({
        title: "Bear Clock",
        photos: ["https://i.ebayimg.com/a.jpg"],
        description: "<p>clock</p>",
      })
    ).toBe(true);
    expect(inboundContentFanoutKind({ contentChange: true, soldOut: false })).toBe("content");
    expect(inboundContentFanoutKind({ contentChange: true, soldOut: true })).toBe("inventory");
  });
});

describe("ebayGetItemEndedDecision", () => {
  const now = new Date("2026-09-01T18:00:00.000Z");

  it("does not unlink eBay when GetItem still reports stock", () => {
    expect(
      ebayGetItemEndedDecision({
        listingEnded: true,
        quantity: 2,
        inwUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        now,
      })
    ).toBe("active");
  });

  it("does not unlink eBay right after an inbound title edit from another shop", () => {
    expect(
      ebayGetItemEndedDecision({
        listingEnded: true,
        quantity: 0,
        inwUpdatedAt: new Date("2026-09-01T17:50:00.000Z"),
        now,
      })
    ).toBe("active");
  });

  it("flags a listing that ended with no stock after the echo window", () => {
    expect(
      ebayGetItemEndedDecision({
        listingEnded: true,
        quantity: 0,
        inwUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        now,
      })
    ).toBe("ended");
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

  it("skips ItemListed LastModified a few seconds after our publish", () => {
    const pushedAt = new Date("2026-08-20T05:06:00.000Z");
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: null,
        lastPushedAt: pushedAt,
        inwUpdatedAt: pushedAt,
        ebayLastModified: new Date("2026-08-20T05:06:12.000Z"),
        now: new Date("2026-08-20T05:06:15.000Z"),
      })
    ).toBe(true);
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

  it("applies an eBay revise whose LastModified is older than a later qty push stamp", () => {
    expect(
      ebayGetItemIsStaleVersusInw({
        lastInboundAt: refreshedAt,
        lastPushedAt: new Date("2026-08-20T05:20:00.000Z"),
        inwUpdatedAt: refreshedAt,
        ebayLastModified: new Date("2026-08-20T05:10:00.000Z"),
        now: new Date("2026-08-20T05:21:00.000Z"),
      })
    ).toBe(false);
  });
});

describe("ebayGetItemApplyDecision", () => {
  const inbound = new Date("2026-08-20T06:50:03.000Z");
  const base = {
    lastInboundAt: inbound,
    lastPushedAt: new Date("2026-08-20T06:29:13.000Z"),
    inwUpdatedAt: inbound,
    ebayLastModified: null as Date | null,
    inwTitle: "Tachometer EBAY CRON TEST 5",
    inwPriceCents: 4000,
    inwQuantity: 4,
    remoteTitle: "Tachometer EBAY CRON TEST 5",
    remotePriceCents: 4000,
    remoteQuantity: 4,
    pendingRemoteHash: null as string | null,
  };

  it("applies the first pull when LastModified is missing", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastInboundAt: null,
        lastPushedAt: null,
        inwUpdatedAt: null,
      }).action
    ).toBe("apply");
  });

  it("skips when GetItem title/price/qty already match INW", () => {
    expect(ebayGetItemApplyDecision(base)).toEqual({ action: "skip", reason: "matches-inw" });
  });

  it("does not skip matches-inw when variation StartPrices differ from INW", () => {
    const skuPriceDiff = {
      ...base,
      inwVariantPricesHash: "inw-sku-prices",
      remoteVariantPricesHash: "ebay-sku-prices",
    };
    expect(ebayGetItemApplyDecision(skuPriceDiff)).not.toEqual({
      action: "skip",
      reason: "matches-inw",
    });
    expect(
      ebayGetItemApplyDecision({ ...skuPriceDiff, source: "webhook" as const })
    ).toMatchObject({ action: "apply" });
  });

  it("does not snap INW SKU prices back to lagged eBay StartPrices when INW is newer", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T07:00:00.000Z"),
        inwUpdatedAt: new Date("2026-08-20T07:00:00.000Z"),
        lastInboundAt: inbound,
        inwVariantPricesHash: "inw-sku-prices",
        remoteVariantPricesHash: "ebay-sku-prices",
        source: "webhook",
        now: new Date("2026-08-20T07:10:00.000Z"),
      })
    ).toEqual({ action: "skip", reason: "inw-newer-than-ebay" });
  });

  it("does not copy a lagged eBay title over an INW save when LastModified is missing", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        inwUpdatedAt: new Date("2026-08-20T06:56:19.000Z"),
        lastInboundAt: new Date("2026-08-20T06:56:18.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 5",
        inwTitle: "Tachometer",
        now: new Date("2026-08-20T07:10:00.000Z"),
      })
    ).toEqual({ action: "skip", reason: "inw-newer-than-ebay" });
  });

  it("skips GetItem without LastModified during the push echo window", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        now: new Date("2026-08-20T06:56:30.000Z"),
      })
    ).toEqual({ action: "skip", reason: "echo-of-push" });
  });

  it("waits for a second identical snapshot before applying a real eBay edit", () => {
    const first = ebayGetItemApplyDecision({
      ...base,
      remoteTitle: "Tachometer EBAY CRON TEST 6",
      now: new Date("2026-08-20T07:00:00.000Z"),
    });
    expect(first).toMatchObject({ action: "pending", reason: "await-confirm" });
    expect(first.pendingHash).toBeTruthy();
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        pendingRemoteHash: first.pendingHash,
        now: new Date("2026-08-20T07:05:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "confirmed-snapshot" });
  });

  it("does not apply a different snapshot than the one pending", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer LIVE",
        pendingRemoteHash: "Tachometer LAGGED|4000|4",
      }).action
    ).toBe("pending");
  });

  it("applies a webhook revise without waiting for a second snapshot", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "webhook",
        now: new Date("2026-08-20T07:00:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "webhook-revise" });
  });

  it("applies a dirty seller-list GetItem on the first cron look", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "cron-dirty",
        now: new Date("2026-08-20T07:00:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "dirty-revise" });
  });

  it("applies a webhook description-only revise when title/price/qty already match", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        source: "webhook",
        inwDescription: "Old body",
        remoteDescription: "New body from eBay",
      })
    ).toMatchObject({ action: "apply", reason: "webhook-revise" });
  });

  it("applies a description-only eBay edit on rotate instead of skipping matches-inw", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        inwDescription: "Old body",
        remoteDescription: "New body from eBay",
      })
    ).toMatchObject({ action: "apply", reason: "remote-revise" });
  });

  it("does not skip a description-only eBay edit as inw-newer", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        inwUpdatedAt: new Date("2026-08-20T07:10:00.000Z"),
        lastInboundAt: new Date("2026-08-20T06:50:03.000Z"),
        inwDescription: "Old body",
        remoteDescription: "New body from eBay",
      })
    ).toMatchObject({ action: "apply", reason: "remote-revise" });
  });

  it("applies a cron-dirty qty revise even when INW looks newer than last inbound", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastInboundAt: new Date("2026-08-20T06:50:03.000Z"),
        inwUpdatedAt: new Date("2026-08-20T07:10:00.000Z"),
        remoteQuantity: 2,
        inwQuantity: 4,
        source: "cron-dirty",
      })
    ).toMatchObject({ action: "apply", reason: "dirty-revise" });
  });

  it("still skips a webhook GetItem that matches INW or is an echo of our push", () => {
    expect(ebayGetItemApplyDecision({ ...base, source: "webhook" })).toEqual({
      action: "skip",
      reason: "matches-inw",
    });
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-08-20T06:56:21.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "webhook",
        now: new Date("2026-08-20T06:56:30.000Z"),
      })
    ).toEqual({ action: "skip", reason: "echo-of-push" });
  });

  it("applies a webhook revise when LastModified looks stale versus INW but fields differ", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        ebayLastModified: new Date("2026-08-20T06:40:00.000Z"),
        remoteTitle: "Tachometer LIVE FROM EBAY",
        source: "webhook",
        now: new Date("2026-08-20T07:00:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "webhook-revise" });
  });

  it("still skips a webhook LastModified that is only an echo of our push", () => {
    const pushedAt = new Date("2026-08-20T06:56:21.000Z");
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: pushedAt,
        ebayLastModified: new Date("2026-08-20T06:56:25.000Z"),
        remoteTitle: "Tachometer EBAY CRON TEST 6",
        source: "webhook",
        now: new Date("2026-08-20T06:56:30.000Z"),
      })
    ).toEqual({ action: "skip", reason: "echo-of-push" });
  });

  it("does not apply cron-dirty or confirmed snapshots of the old eBay title after an INW save", () => {
    const inwNewer = {
      ...base,
      inwUpdatedAt: new Date("2026-08-20T07:10:00.000Z"),
      inwTitle: "Vintage Bear Clock",
      remoteTitle: "Vintage Bear Clock (Testing) Etsy Works 2?",
      lastSyncedTitle: "Vintage Bear Clock (Testing) Etsy Works 2?",
    };
    expect(ebayGetItemApplyDecision({ ...inwNewer, source: "cron-dirty" })).toEqual({
      action: "skip",
      reason: "inw-newer-than-ebay",
    });
    expect(
      ebayGetItemApplyDecision({
        ...inwNewer,
        pendingRemoteHash: "Vintage Bear Clock (Testing) Etsy Works 2?|4000|4",
      })
    ).toEqual({ action: "skip", reason: "inw-newer-than-ebay" });
  });

  it("applies a live eBay title that is not the last synced title even when INW looks newer", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-09-10T02:26:13.756Z"),
        inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
        inwTitle: "Vintage Bear Clock (Testing) S",
        remoteTitle: "Vintage Bear Clock (Testing) Sync Ebay",
        remotePriceCents: 200,
        inwPriceCents: 200,
        remoteQuantity: 49,
        inwQuantity: 49,
        lastSyncedTitle: "Vintage Bear Clock (Testing) S",
        source: "cron-dirty",
        now: new Date("2026-09-10T02:30:30.201Z"),
      })
    ).toMatchObject({ action: "apply", reason: "dirty-revise" });
  });

  it("applies an independent eBay title on rotate without waiting for a second snapshot", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-09-10T02:26:13.756Z"),
        inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
        inwTitle: "Vintage Bear Clock (Testing) S",
        remoteTitle: "Vintage Bear Clock (Testing) Sync Ebay",
        remotePriceCents: 200,
        inwPriceCents: 200,
        remoteQuantity: 49,
        inwQuantity: 49,
        lastSyncedTitle: "Vintage Bear Clock (Testing) S",
        now: new Date("2026-09-10T02:30:30.201Z"),
      })
    ).toMatchObject({ action: "apply", reason: "remote-revise" });
  });

  it("applies a live eBay title after Etsy restamped INW so cron cannot skip the eBay edit", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-09-10T01:00:00.000Z"),
        lastInboundAt: new Date("2026-09-10T02:00:00.000Z"),
        inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
        inwTitle: "Vintage Bear Clock",
        lastSyncedTitle: "Vintage Bear Clock (Testing) S",
        remoteTitle: "Vintage Bear Clock (Testing) Sync Ebay",
        remotePriceCents: 200,
        inwPriceCents: 200,
        remoteQuantity: 49,
        inwQuantity: 49,
        now: new Date("2026-09-10T02:30:30.201Z"),
      })
    ).toMatchObject({ action: "apply", reason: "remote-revise" });
  });

  it("does not apply a lagged GetItem title after we just pushed the new INW title", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastPushedAt: new Date("2026-09-10T02:26:13.756Z"),
        lastInboundAt: new Date("2026-09-10T01:00:00.000Z"),
        inwUpdatedAt: new Date("2026-09-10T02:26:10.000Z"),
        inwTitle: "Vintage Bear Clock (Testing) Sync Ebay",
        lastSyncedTitle: "Vintage Bear Clock (Testing) S",
        remoteTitle: "Vintage Bear Clock (Testing) S",
        remotePriceCents: 200,
        inwPriceCents: 200,
        remoteQuantity: 49,
        inwQuantity: 49,
        now: new Date("2026-09-10T02:30:30.201Z"),
      })
    ).toEqual({ action: "skip", reason: "inw-newer-than-ebay" });
  });

  it("applies an eBay title revise on cron-dirty when this listing has never pulled", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastInboundAt: null,
        lastPushedAt: new Date("2026-09-10T02:26:13.756Z"),
        inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
        inwTitle: "Vintage Bear Clock (Testing) S",
        remoteTitle: "Vintage Bear Clock (Testing) Sync Ebay",
        remotePriceCents: 200,
        inwPriceCents: 200,
        remoteQuantity: 49,
        inwQuantity: 49,
        source: "cron-dirty",
        now: new Date("2026-09-10T02:30:30.201Z"),
      })
    ).toMatchObject({ action: "apply", reason: "dirty-revise" });
  });

  it("confirms a never-pulled eBay title revise on the second rotate look", () => {
    const neverPulled = {
      ...base,
      lastInboundAt: null,
      lastPushedAt: new Date("2026-09-10T02:26:13.756Z"),
      inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
      inwTitle: "Vintage Bear Clock (Testing) S",
      remoteTitle: "Vintage Bear Clock (Testing) Sync Ebay",
      remotePriceCents: 200,
      inwPriceCents: 200,
      remoteQuantity: 49,
      inwQuantity: 49,
    };
    const first = ebayGetItemApplyDecision(neverPulled);
    expect(first).toMatchObject({ action: "pending", reason: "await-confirm" });
    expect(
      ebayGetItemApplyDecision({ ...neverPulled, pendingRemoteHash: first.pendingHash })
    ).toMatchObject({ action: "apply", reason: "confirmed-snapshot" });
  });

  it("does not revert a just-applied value from a lagged rotate GetItem in the settle window", () => {
    // We pulled the seller's eBay edit (title=New) into INW at 02:00. A rotate GetItem at 02:05
    // still returns the PRE-edit title (Old); without a strictly-newer LastModifiedTime it must
    // NOT snap the just-applied value back — require a second consistent look first.
    const lagged = {
      ...base,
      lastInboundAt: new Date("2026-09-10T02:00:00.000Z"),
      inwTitle: "New Seller Title",
      remoteTitle: "Old Title",
      lastSyncedTitle: "New Seller Title",
      ebayLastModified: null as Date | null,
      now: new Date("2026-09-10T02:05:00.000Z"),
    };
    const first = ebayGetItemApplyDecision(lagged);
    expect(first).toMatchObject({ action: "pending", reason: "settle-await-confirm" });
    // A second consistent look (still Old) confirms it is a genuine revert and applies.
    expect(
      ebayGetItemApplyDecision({ ...lagged, pendingRemoteHash: first.pendingHash })
    ).toMatchObject({ action: "apply", reason: "remote-revise" });
  });

  it("applies an independent rotate revise immediately once past the settle window", () => {
    expect(
      ebayGetItemApplyDecision({
        ...base,
        lastInboundAt: new Date("2026-09-10T02:00:00.000Z"),
        inwTitle: "New Seller Title",
        remoteTitle: "Old Title",
        lastSyncedTitle: "New Seller Title",
        ebayLastModified: null,
        now: new Date("2026-09-10T02:15:00.000Z"),
      })
    ).toMatchObject({ action: "apply", reason: "remote-revise" });
  });
});

describe("ebayInPostInboundSettleWindow", () => {
  const inbound = new Date("2026-09-10T02:00:00.000Z");

  it("is true within the window after an inbound apply", () => {
    expect(
      ebayInPostInboundSettleWindow({
        lastInboundAt: inbound,
        now: new Date(inbound.getTime() + EBAY_POST_INBOUND_SETTLE_MS - 1),
      })
    ).toBe(true);
  });

  it("is false once the window elapses", () => {
    expect(
      ebayInPostInboundSettleWindow({
        lastInboundAt: inbound,
        now: new Date(inbound.getTime() + EBAY_POST_INBOUND_SETTLE_MS + 1),
      })
    ).toBe(false);
  });

  it("is false when the listing has never pulled", () => {
    expect(ebayInPostInboundSettleWindow({ lastInboundAt: null })).toBe(false);
  });
});

describe("ebayGetItemShouldPreserveInwContent", () => {
  const inbound = new Date("2026-08-20T06:50:03.000Z");

  it("adopts eBay content on the first pull", () => {
    expect(
      ebayGetItemShouldPreserveInwContent({
        inwUpdatedAt: null,
        lastInboundAt: null,
        lastPushedAt: null,
      })
    ).toBe(false);
  });

  it("does not treat a never-pulled INW-created listing as newer than eBay", () => {
    expect(
      ebayGetItemShouldPreserveInwContent({
        inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
        lastInboundAt: null,
        lastPushedAt: new Date("2026-09-10T02:26:13.756Z"),
      })
    ).toBe(false);
  });

  it("keeps a later INW save when GetItem has no LastModified", () => {
    expect(
      ebayGetItemShouldPreserveInwContent({
        inwUpdatedAt: new Date("2026-08-20T07:10:00.000Z"),
        lastInboundAt: inbound,
        lastPushedAt: inbound,
      })
    ).toBe(true);
  });

  it("lets a newer eBay LastModified overwrite INW", () => {
    expect(
      ebayGetItemShouldPreserveInwContent({
        inwUpdatedAt: inbound,
        lastInboundAt: inbound,
        ebayLastModified: new Date("2026-08-20T07:20:00.000Z"),
      })
    ).toBe(false);
  });
});

describe("shouldApplyEbayInboundVariants", () => {
  const local = [
    {
      name: "Size",
      options: [
        { value: "S", quantity: 4 },
        { value: "M", quantity: 3 },
        { value: "L", quantity: 2 },
      ],
    },
  ];
  it("rejects a post-publish snapshot that dropped options", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 1 },
              { value: "M", quantity: 1 },
            ],
          },
        ],
      })
    ).toBe(false);
  });

  it("rejects all-qty-1 echo when we already track richer option stock", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 1 },
              { value: "M", quantity: 1 },
              { value: "L", quantity: 1 },
            ],
          },
        ],
      })
    ).toBe(false);
  });

  it("rejects a MIXED degraded snapshot (e.g. {S:1,M:1,L:5}) over real per-option stock", () => {
    // Regression: the old all-1s-only guard let this through and wiped S/M to 1.
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 1 },
              { value: "M", quantity: 1 },
              { value: "L", quantity: 5 },
            ],
          },
        ],
      })
    ).toBe(false);
  });

  it("does NOT copy GetItem per-option qty even when values line up (Inventory API is source)", () => {
    // GetItem per-option qty is never trustworthy for variation listings; eBay stock syncs
    // via the Inventory API / offering stock, so we refuse to overwrite real local stock.
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: local,
        remoteVariants: [
          {
            name: "Size",
            options: [
              { value: "S", quantity: 4 },
              { value: "M", quantity: 2 },
              { value: "L", quantity: 2 },
            ],
          },
        ],
      })
    ).toBe(false);
  });

  it("applies remote variants when INW has none (import)", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: null,
        remoteVariants: [
          { name: "Size", options: [{ value: "S", quantity: 1 }, { value: "M", quantity: 2 }] },
        ],
      })
    ).toBe(true);
  });

  it("applies a matrix snapshot with combination prices", () => {
    expect(
      shouldApplyEbayInboundVariants({
        localVariants: null,
        remoteVariants: {
          axes: [
            { name: "Size", values: ["S"] },
            { name: "Color", values: ["Navy"] },
          ],
          skus: [{ options: { Size: "S", Color: "Navy" }, quantity: 2, priceCents: 2450 }],
        },
      })
    ).toBe(true);
  });
});

describe("ebayGetItemShouldApplyListingQuantity", () => {
  it("does not copy GetItem listing Quantity onto per-option stock", () => {
    expect(
      ebayGetItemShouldApplyListingQuantity({
        localHasOptionQuantities: true,
        applyRemoteVariants: false,
      })
    ).toBe(false);
  });

  it("allows listing Quantity on a simple listing", () => {
    expect(
      ebayGetItemShouldApplyListingQuantity({
        localHasOptionQuantities: false,
        applyRemoteVariants: false,
      })
    ).toBe(true);
  });
});

describe("ebay pending inbound hash", () => {
  it("stores and clears the pending snapshot on conflictDetails", () => {
    const withPending = withEbayPendingInbound({ other: 1 }, { hash: "a|1|1", seenAt: "t" });
    expect(readEbayPendingInboundHash(withPending)).toBe("a|1|1");
    expect((withPending as { other: number }).other).toBe(1);
    expect(readEbayPendingInboundHash(withEbayPendingInbound(withPending, null))).toBeNull();
  });
});

describe("ebayCronShouldRetryOutbound", () => {
  it("retries failed live listings and skips ended ones", () => {
    expect(
      ebayCronShouldRetryOutbound({ syncEnabled: true, syncStatus: "error", ended: false })
    ).toBe(true);
    expect(
      ebayCronShouldRetryOutbound({ syncEnabled: true, syncStatus: "synced", ended: false })
    ).toBe(false);
    expect(
      ebayCronShouldRetryOutbound({ syncEnabled: true, syncStatus: "error", ended: true })
    ).toBe(false);
  });
});

describe("ebayCronShouldPushOutbound", () => {
  const inw = new Date("2026-09-09T18:00:00.000Z");
  it("retries error rows and INW saves newer than both push and inbound", () => {
    expect(
      ebayCronShouldPushOutbound({
        syncEnabled: true,
        syncStatus: "error",
        ended: false,
        inwUpdatedAt: inw,
        lastPushedAt: inw,
        lastInboundAt: inw,
      })
    ).toBe(true);
    expect(
      ebayCronShouldPushOutbound({
        syncEnabled: true,
        syncStatus: "synced",
        ended: false,
        inwUpdatedAt: inw,
        lastPushedAt: new Date("2026-09-09T17:00:00.000Z"),
        lastInboundAt: new Date("2026-09-09T16:00:00.000Z"),
      })
    ).toBe(true);
  });

  it("does not re-push a GetItem inbound echo or a successful save-time push", () => {
    expect(
      ebayCronShouldPushOutbound({
        syncEnabled: true,
        syncStatus: "synced",
        ended: false,
        inwUpdatedAt: inw,
        lastPushedAt: new Date("2026-09-09T17:00:00.000Z"),
        lastInboundAt: inw,
      })
    ).toBe(false);
    expect(
      ebayCronShouldPushOutbound({
        syncEnabled: true,
        syncStatus: "synced",
        ended: false,
        inwUpdatedAt: inw,
        lastPushedAt: new Date("2026-09-09T18:01:00.000Z"),
        lastInboundAt: new Date("2026-09-09T17:00:00.000Z"),
      })
    ).toBe(false);
  });

  it("does NOT push when eBay is dirty but the live GetItem was inconclusive", () => {
    // INW looks newer than both push and inbound (would normally push), but eBay diverged and
    // we could not read it — pushing would clobber the seller's eBay edit.
    expect(
      ebayCronShouldPushOutbound({
        syncEnabled: true,
        syncStatus: "synced",
        ended: false,
        inwUpdatedAt: inw,
        lastPushedAt: new Date("2026-09-09T16:00:00.000Z"),
        lastInboundAt: new Date("2026-09-09T16:00:00.000Z"),
        dirtyInboundUnconfirmed: true,
      })
    ).toBe(false);
  });

  it("does NOT retry even an error row while a dirty inbound is unconfirmed", () => {
    expect(
      ebayCronShouldPushOutbound({
        syncEnabled: true,
        syncStatus: "error",
        ended: false,
        inwUpdatedAt: inw,
        lastPushedAt: inw,
        lastInboundAt: inw,
        dirtyInboundUnconfirmed: true,
      })
    ).toBe(false);
  });
});

describe("ebayDirtyInboundUnconfirmed", () => {
  const now = new Date("2026-09-09T18:00:00.000Z");

  it("is false when there is no marker", () => {
    expect(ebayDirtyInboundUnconfirmed({}, now)).toBe(false);
    expect(ebayDirtyInboundUnconfirmed(null, now)).toBe(false);
  });

  it("blocks outbound while the marker is fresh", () => {
    const cd = withEbayDirtyUnconfirmed({}, new Date("2026-09-09T17:55:00.000Z"));
    expect(ebayDirtyInboundUnconfirmed(cd, now)).toBe(true);
  });

  it("expires via the TTL so a permanently unreadable listing cannot strand outbound", () => {
    const stale = new Date(now.getTime() - EBAY_DIRTY_UNCONFIRMED_TTL_MS - 1_000);
    const cd = withEbayDirtyUnconfirmed({}, stale);
    expect(ebayDirtyInboundUnconfirmed(cd, now)).toBe(false);
  });

  it("clears the marker when passed null (conclusive GetItem)", () => {
    const set = withEbayDirtyUnconfirmed({ other: "keep" }, now) as Record<string, unknown>;
    expect(set.ebayDirtyUnconfirmedAt).toBeDefined();
    const cleared = withEbayDirtyUnconfirmed(set, null) as Record<string, unknown>;
    expect(cleared.ebayDirtyUnconfirmedAt).toBeUndefined();
    expect(cleared.other).toBe("keep");
  });
});
