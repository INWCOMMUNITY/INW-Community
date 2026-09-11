import { describe, expect, it } from "vitest";
import {
  inboundRefreshShouldPull,
  inboundRefreshShouldPullVariantPrices,
  isInboundCatalogContentEcho,
  isOwnChannelPushEcho,
  newerChannelQtyEditShouldPull,
  remoteCatalogChangedSinceBaseline,
  remoteListingDisagreesForSync,
  remoteQtyOnlyShouldPull,
  shouldFlagWixRemoteDeleted,
  shouldHoldQtyPushForUntrustedRemote,
  shouldLogCatalogConflict,
} from "./inbound-catalog-decision";

const echoBase = {
  inwContentChanged: true,
  remoteContentChanged: false,
  qtyDiffers: false,
  titleOrPriceDiffers: false,
  descriptionDiffers: false,
  remoteContentActuallyDiffers: false,
  marketplaceCdnPhotoRehostOnly: false,
  inwHostedPhotosChangedSinceLastPush: false,
};

describe("isInboundCatalogContentEcho", () => {
  it("rewrites baseline when the hash drifted but title/price/description match", () => {
    expect(isInboundCatalogContentEcho(echoBase)).toBe(true);
  });

  it("treats same-count Wix/Etsy CDN re-hosts as echo", () => {
    expect(
      isInboundCatalogContentEcho({
        ...echoBase,
        remoteContentActuallyDiffers: true,
        marketplaceCdnPhotoRehostOnly: true,
      })
    ).toBe(true);
  });

  it("still pushes a real INW Blob photo change", () => {
    expect(
      isInboundCatalogContentEcho({
        ...echoBase,
        remoteContentActuallyDiffers: true,
        inwHostedPhotosChangedSinceLastPush: true,
      })
    ).toBe(false);
  });

  it("still pushes when title or description actually differ", () => {
    expect(isInboundCatalogContentEcho({ ...echoBase, titleOrPriceDiffers: true })).toBe(false);
    expect(isInboundCatalogContentEcho({ ...echoBase, descriptionDiffers: true })).toBe(false);
  });

  it("does not apply when the channel listing itself changed", () => {
    expect(isInboundCatalogContentEcho({ ...echoBase, remoteContentChanged: true })).toBe(false);
  });
});

describe("isOwnChannelPushEcho", () => {
  it("treats a Wix lastUpdated bump right after our PATCH as an echo", () => {
    const lastPushedAt = new Date("2026-09-09T01:25:20.000Z");
    expect(
      isOwnChannelPushEcho({
        lastPushedAt,
        remoteUpdatedAt: new Date("2026-09-09T01:25:29.346Z"),
        nowMs: lastPushedAt.getTime() + 8_000,
      })
    ).toBe(true);
  });

  it("treats INW and Wix timestamps a few seconds apart as a hub fan-out echo", () => {
    expect(
      isOwnChannelPushEcho({
        lastPushedAt: new Date("2026-09-09T02:00:36.784Z"),
        remoteUpdatedAt: new Date("2026-09-09T02:21:13.647Z"),
        inwUpdatedAt: new Date("2026-09-09T02:21:11.335Z"),
        nowMs: new Date("2026-09-09T02:21:20.056Z").getTime(),
      })
    ).toBe(true);
  });

  it("does not treat a real Etsy title/qty edit as a hub fan-out echo", () => {
    expect(
      isOwnChannelPushEcho({
        lastPushedAt: new Date("2026-09-09T02:00:36.784Z"),
        remoteUpdatedAt: new Date("2026-09-09T02:21:13.647Z"),
        inwUpdatedAt: new Date("2026-09-09T02:21:11.335Z"),
        nowMs: new Date("2026-09-09T02:21:20.056Z").getTime(),
        listingsDisagree: true,
      })
    ).toBe(false);
  });

  it("still treats a lastUpdated bump right after our PATCH as an echo when titles differ", () => {
    const lastPushedAt = new Date("2026-09-09T01:25:20.000Z");
    expect(
      isOwnChannelPushEcho({
        lastPushedAt,
        remoteUpdatedAt: new Date("2026-09-09T01:25:29.346Z"),
        listingsDisagree: true,
        nowMs: lastPushedAt.getTime() + 8_000,
      })
    ).toBe(true);
  });

  it("is false when the last push was hours ago and INW was not just saved", () => {
    expect(
      isOwnChannelPushEcho({
        lastPushedAt: new Date("2026-09-08T12:00:00.000Z"),
        remoteUpdatedAt: new Date("2026-09-09T01:25:29.346Z"),
        inwUpdatedAt: new Date("2026-09-08T12:00:00.000Z"),
        nowMs: new Date("2026-09-09T01:26:00.000Z").getTime(),
      })
    ).toBe(false);
  });
});

describe("remoteCatalogChangedSinceBaseline", () => {
  const base = {
    remoteTimestampNewer: true,
    remoteHashDiffersFromBaseline: true,
    remoteDisagreesWithInw: true,
    titleOrPriceDiffers: true,
    descriptionDiffers: false,
    inwContentChanged: true,
    isOwnPushEcho: false,
    remoteUpdatedAt: new Date("2026-09-09T01:25:29.346Z"),
  };

  it("does not treat our own Wix push echo as a remote edit", () => {
    expect(remoteCatalogChangedSinceBaseline({ ...base, isOwnPushEcho: true })).toBe(false);
  });

  it("does not treat hash/CDN drift as a remote edit when listings already match", () => {
    expect(
      remoteCatalogChangedSinceBaseline({
        ...base,
        remoteDisagreesWithInw: false,
        titleOrPriceDiffers: false,
      })
    ).toBe(false);
  });

  it("detects a real dual edit when title/price disagree and the channel timestamp is newer", () => {
    expect(remoteCatalogChangedSinceBaseline(base)).toBe(true);
  });
});

describe("shouldLogCatalogConflict", () => {
  it("does not log a conflict when INW was saved and Wix still matches", () => {
    expect(
      shouldLogCatalogConflict({
        inwContentChanged: true,
        remoteContentChanged: true,
        remoteDisagreesWithInw: false,
      })
    ).toBe(false);
  });

  it("does not log a 2-second Wix lastUpdated bump after an INW hub save", () => {
    expect(
      shouldLogCatalogConflict({
        inwContentChanged: true,
        remoteContentChanged: true,
        remoteDisagreesWithInw: true,
        inwUpdatedAt: new Date("2026-09-09T02:21:11.335Z"),
        remoteUpdatedAt: new Date("2026-09-09T02:21:13.647Z"),
      })
    ).toBe(false);
  });

  it("logs only when both sides changed, listings disagree, and timestamps are not an echo", () => {
    expect(
      shouldLogCatalogConflict({
        inwContentChanged: true,
        remoteContentChanged: true,
        remoteDisagreesWithInw: true,
        inwUpdatedAt: new Date("2026-09-09T01:00:00.000Z"),
        remoteUpdatedAt: new Date("2026-09-09T02:00:00.000Z"),
      })
    ).toBe(true);
  });
});

describe("remoteListingDisagreesForSync", () => {
  it("ignores an empty remote description from a catalog list", () => {
    expect(
      remoteListingDisagreesForSync({
        titleOrPriceDiffers: false,
        descriptionDiffers: true,
        remoteDescriptionPresent: false,
        photosDiffer: false,
        marketplaceCdnPhotoRehostOnly: false,
      })
    ).toBe(false);
  });

  it("ignores marketplace CDN photo rehosts", () => {
    expect(
      remoteListingDisagreesForSync({
        titleOrPriceDiffers: false,
        descriptionDiffers: false,
        remoteDescriptionPresent: false,
        photosDiffer: true,
        marketplaceCdnPhotoRehostOnly: true,
      })
    ).toBe(false);
  });
});

describe("remoteQtyOnlyShouldPull", () => {
  it("pulls an Etsy qty edit when INW qty did not change", () => {
    expect(
      remoteQtyOnlyShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 4,
        baselineQty: 4,
        inwQtyChangedSinceBaseline: false,
      })
    ).toBe(true);
  });

  it("pulls when there is no qty baseline instead of pushing INW over Etsy", () => {
    expect(
      remoteQtyOnlyShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 4,
        baselineQty: null,
        inwQtyChangedSinceBaseline: false,
      })
    ).toBe(true);
  });

  it("does not pull when INW qty already moved", () => {
    expect(
      remoteQtyOnlyShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 5,
        baselineQty: 4,
        inwQtyChangedSinceBaseline: true,
      })
    ).toBe(false);
  });

  it("does not pull shop-list quantity that is not trusted", () => {
    expect(
      remoteQtyOnlyShouldPull({
        remoteQtyKnown: false,
        remoteQuantity: 0,
        inwQuantity: 49,
        baselineQty: 49,
        inwQtyChangedSinceBaseline: false,
      })
    ).toBe(false);
  });
});

describe("newerChannelQtyEditShouldPull", () => {
  const older = new Date("2026-09-10T01:00:00.000Z");
  const newer = new Date("2026-09-10T02:00:00.000Z");

  it("pulls when only the channel moved (INW at baseline)", () => {
    expect(
      newerChannelQtyEditShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 4,
        inwQtyChangedSinceBaseline: false,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        baselineAt: older,
      })
    ).toBe(true);
  });

  it("pulls the snap-back case: baseline drifted but the channel is the newer edit", () => {
    // INW qty drifted from baseline (e.g. a sale elsewhere), yet Etsy was edited most recently.
    // The old baseline-only rule pushed INW's stale qty back; recency must PULL instead.
    expect(
      newerChannelQtyEditShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 5,
        inwQtyChangedSinceBaseline: true,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        baselineAt: older,
      })
    ).toBe(true);
  });

  it("does not pull when INW is the newer edit (both changed)", () => {
    expect(
      newerChannelQtyEditShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 5,
        inwQtyChangedSinceBaseline: true,
        inwUpdatedAt: newer,
        remoteUpdatedAt: older,
        baselineAt: older,
      })
    ).toBe(false);
  });

  it("does not pull inside the settle window (our own push echo)", () => {
    const future = new Date(Date.now() + 60_000);
    expect(
      newerChannelQtyEditShouldPull({
        remoteQtyKnown: true,
        remoteQuantity: 6,
        inwQuantity: 4,
        inwQtyChangedSinceBaseline: false,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        baselineAt: future,
      })
    ).toBe(false);
  });

  it("does not pull when the remote quantity is unknown", () => {
    expect(
      newerChannelQtyEditShouldPull({
        remoteQtyKnown: false,
        remoteQuantity: 0,
        inwQuantity: 4,
        inwQtyChangedSinceBaseline: false,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        baselineAt: older,
      })
    ).toBe(false);
  });
});

describe("shouldHoldQtyPushForUntrustedRemote", () => {
  const older = new Date("2026-09-10T01:00:00.000Z");
  const newer = new Date("2026-09-10T02:00:00.000Z");

  it("holds an Etsy push when remote qty is unknown and not proven stale", () => {
    expect(
      shouldHoldQtyPushForUntrustedRemote({
        provider: "etsy",
        remoteQtyKnown: false,
        remoteUpdatedAt: newer,
        inwUpdatedAt: older,
      })
    ).toBe(true);
  });

  it("allows the push when the remote timestamp proves INW is strictly newer", () => {
    expect(
      shouldHoldQtyPushForUntrustedRemote({
        provider: "etsy",
        remoteQtyKnown: false,
        remoteUpdatedAt: older,
        inwUpdatedAt: newer,
      })
    ).toBe(false);
  });

  it("never holds when the remote quantity is trusted", () => {
    expect(
      shouldHoldQtyPushForUntrustedRemote({
        provider: "etsy",
        remoteQtyKnown: true,
        remoteUpdatedAt: newer,
        inwUpdatedAt: older,
      })
    ).toBe(false);
  });

  it("only applies to Etsy", () => {
    expect(
      shouldHoldQtyPushForUntrustedRemote({
        provider: "ebay",
        remoteQtyKnown: false,
        remoteUpdatedAt: newer,
        inwUpdatedAt: older,
      })
    ).toBe(false);
  });
});

describe("inboundRefreshShouldPull", () => {
  const older = new Date("2026-09-09T01:00:00.000Z");
  const newer = new Date("2026-09-09T02:00:00.000Z");

  it("pulls when only the remote changed", () => {
    expect(
      inboundRefreshShouldPull({
        inwContentChanged: false,
        remoteContentChanged: true,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        ownPushEcho: false,
      })
    ).toBe(true);
  });

  it("does not pull when it is our own push echoing back", () => {
    expect(
      inboundRefreshShouldPull({
        inwContentChanged: false,
        remoteContentChanged: true,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        ownPushEcho: true,
      })
    ).toBe(false);
  });

  it("does not pull (clobber) when the Hub edit is newer and unpushed", () => {
    expect(
      inboundRefreshShouldPull({
        inwContentChanged: true,
        remoteContentChanged: false,
        inwUpdatedAt: newer,
        remoteUpdatedAt: older,
        ownPushEcho: false,
      })
    ).toBe(false);
  });

  it("resolves a two-sided conflict by most-recent (remote newer -> pull)", () => {
    expect(
      inboundRefreshShouldPull({
        inwContentChanged: true,
        remoteContentChanged: true,
        inwUpdatedAt: older,
        remoteUpdatedAt: newer,
        ownPushEcho: false,
      })
    ).toBe(true);
  });
});

describe("inboundRefreshShouldPullVariantPrices", () => {
  const older = new Date("2026-09-09T01:00:00.000Z");
  const newer = new Date("2026-09-09T02:00:00.000Z");
  const base = {
    inwVariantsChanged: false,
    remotePricesKnown: true,
    remotePriceFingerprint: "remote-sku-prices",
    inwPriceFingerprint: "inw-sku-prices",
    inwUpdatedAt: older,
    remoteUpdatedAt: newer,
    ownPushEcho: false,
  };

  it("pulls a variant-price-only refresh when the remote is newer", () => {
    expect(inboundRefreshShouldPullVariantPrices(base)).toBe(true);
  });

  it("does not pull when remote SKU prices are unknown", () => {
    expect(inboundRefreshShouldPullVariantPrices({ ...base, remotePricesKnown: false })).toBe(false);
  });

  it("does not pull when fingerprints already match", () => {
    expect(
      inboundRefreshShouldPullVariantPrices({
        ...base,
        remotePriceFingerprint: "same",
        inwPriceFingerprint: "same",
      })
    ).toBe(false);
  });

  it("does not pull our own push echoing back", () => {
    expect(inboundRefreshShouldPullVariantPrices({ ...base, ownPushEcho: true })).toBe(false);
  });

  it("does not clobber a newer unpushed INW variant-price edit", () => {
    expect(
      inboundRefreshShouldPullVariantPrices({
        ...base,
        inwVariantsChanged: true,
        inwUpdatedAt: newer,
        remoteUpdatedAt: older,
      })
    ).toBe(false);
  });

  it("does not pull old channel SKU prices after we already pushed the current INW prices", () => {
    expect(
      inboundRefreshShouldPullVariantPrices({
        ...base,
        lastPushedPriceFingerprint: "inw-sku-prices",
      })
    ).toBe(false);
  });
});

describe("shouldFlagWixRemoteDeleted", () => {
  it("flags only when a per-product probe confirms the product is gone", () => {
    expect(
      shouldFlagWixRemoteDeleted({
        confirmedGone: true,
        alreadyPending: false,
        storeItemStatus: "active",
      })
    ).toBe(true);
  });

  it("never flags on catalog absence alone (empty/truncated read)", () => {
    expect(
      shouldFlagWixRemoteDeleted({
        confirmedGone: false,
        alreadyPending: false,
        storeItemStatus: "active",
      })
    ).toBe(false);
  });

  it("does not re-flag a listing already pending", () => {
    expect(
      shouldFlagWixRemoteDeleted({
        confirmedGone: true,
        alreadyPending: true,
        storeItemStatus: "active",
      })
    ).toBe(false);
  });

  it("does not flag sold-out or inactive items (they take a different path)", () => {
    expect(
      shouldFlagWixRemoteDeleted({
        confirmedGone: true,
        alreadyPending: false,
        storeItemStatus: "sold_out",
      })
    ).toBe(false);
    expect(
      shouldFlagWixRemoteDeleted({
        confirmedGone: true,
        alreadyPending: false,
        storeItemStatus: "inactive",
      })
    ).toBe(false);
  });
});
