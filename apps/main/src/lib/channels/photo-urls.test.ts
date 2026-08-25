import { describe, expect, it } from "vitest";
import {
  inboundListingPhotosDiffer,
  isInwHostedPhotoUrl,
  isMarketplaceCdnPhotoUrl,
  selectInboundListingPhotos,
} from "./photo-urls";

describe("isInwHostedPhotoUrl", () => {
  it("detects Vercel Blob and local uploads", () => {
    expect(isInwHostedPhotoUrl("https://abc.public.blob.vercel-storage.com/clock.jpg")).toBe(true);
    expect(isInwHostedPhotoUrl("https://blob.vercel-storage.com/clock.jpg")).toBe(true);
    expect(isInwHostedPhotoUrl("/uploads/business/1/photo.jpg")).toBe(true);
    expect(isInwHostedPhotoUrl("https://www.inwcommunity.com/uploads/business/1/photo.jpg")).toBe(
      true
    );
  });

  it("rejects marketplace CDNs", () => {
    expect(isInwHostedPhotoUrl("https://i.ebayimg.com/images/g/xx/s-l2000.jpg")).toBe(false);
    expect(isInwHostedPhotoUrl("https://i.etsystatic.com/1/il_fullxfull.1.jpg")).toBe(false);
  });
});

describe("selectInboundListingPhotos", () => {
  const blob = ["https://abc.public.blob.vercel-storage.com/clock.jpg"];
  const eps = ["https://i.ebayimg.com/images/g/xx/s-l2000.jpg"];
  const epsThumb = ["https://i.ebayimg.com/images/g/xx/s-l500.jpg"];
  const etsy = ["https://i.etsystatic.com/1/il_fullxfull.1.jpg"];

  it("keeps INW Blob photos when inbound is a marketplace CDN", () => {
    expect(selectInboundListingPhotos(blob, eps)).toEqual(blob);
    expect(inboundListingPhotosDiffer(blob, eps)).toBe(false);
  });

  it("fills empty INW photos from the remote set", () => {
    expect(selectInboundListingPhotos([], eps)).toEqual(eps);
  });

  it("keeps local photos when remote is empty", () => {
    expect(selectInboundListingPhotos(blob, [])).toEqual(blob);
  });

  it("applies marketplace updates when INW already stores CDN URLs", () => {
    expect(selectInboundListingPhotos(epsThumb, eps)).toEqual(eps);
    expect(inboundListingPhotosDiffer(epsThumb, eps)).toBe(true);
  });

  it("applies Etsy CDN updates for imported Etsy listings", () => {
    const next = ["https://i.etsystatic.com/1/il_fullxfull.2.jpg"];
    expect(selectInboundListingPhotos(etsy, next)).toEqual(next);
  });
});

describe("isMarketplaceCdnPhotoUrl", () => {
  it("detects eBay, Etsy, Wix, and Shopify hosts", () => {
    expect(isMarketplaceCdnPhotoUrl("https://i.ebayimg.com/images/g/x/s-l2000.jpg")).toBe(true);
    expect(isMarketplaceCdnPhotoUrl("https://i.etsystatic.com/a.jpg")).toBe(true);
    expect(isMarketplaceCdnPhotoUrl("https://static.wixstatic.com/media/abc~mv2.jpg")).toBe(true);
    expect(isMarketplaceCdnPhotoUrl("https://cdn.shopify.com/s/files/1/a.jpg")).toBe(true);
    expect(isMarketplaceCdnPhotoUrl("https://example.com/photo.jpg")).toBe(false);
  });
});
