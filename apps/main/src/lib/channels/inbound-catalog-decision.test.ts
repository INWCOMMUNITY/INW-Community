import { describe, expect, it } from "vitest";
import { isInboundCatalogContentEcho } from "./inbound-catalog-decision";

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
