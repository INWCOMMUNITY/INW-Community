import { describe, expect, it } from "vitest";
import {
  remoteContentDiffersFromStoreItem,
  remoteTitleOrPriceDiffersFromStoreItem,
} from "./apply-remote-listing";
import type { RemoteListingSummary } from "./types";

function remote(overrides: Partial<RemoteListingSummary> = {}): RemoteListingSummary {
  return {
    externalListingId: "1",
    title: "Clock",
    description: "A clock",
    priceCents: 1000,
    quantity: 1,
    photos: ["https://i.ebayimg.com/images/g/xx/s-l2000.jpg"],
    ...overrides,
  };
}

describe("remoteTitleOrPriceDiffersFromStoreItem", () => {
  const inw = {
    title: "United States Navy - Bureau of Ordnance / Tachometer w Case NICE!",
    priceCents: 5500,
  };

  it("detects an eBay-native title and price edit without a last-modified timestamp", () => {
    expect(
      remoteTitleOrPriceDiffersFromStoreItem(inw, {
        title: "United States Navy - Bureau of Ordnance / Tachometer w Case EBAY CRON TEST",
        priceCents: 6000,
      })
    ).toBe(true);
  });

  it("ignores photo/description-only drift (title and price match)", () => {
    expect(
      remoteTitleOrPriceDiffersFromStoreItem(inw, {
        title: inw.title,
        priceCents: 5500,
      })
    ).toBe(false);
  });

  it("does not treat eBay's 80-char title cap as an edit", () => {
    const long = "A".repeat(90);
    expect(
      remoteTitleOrPriceDiffersFromStoreItem(
        { title: long, priceCents: 1000 },
        { title: long.slice(0, 80), priceCents: 1000 }
      )
    ).toBe(false);
  });
});

describe("remoteContentDiffersFromStoreItem photos", () => {
  const blobItem = {
    title: "Clock",
    description: "A clock",
    photos: ["https://abc.public.blob.vercel-storage.com/clock.jpg"],
    priceCents: 1000,
  };

  it("does not treat Blob vs eBay CDN as a photo change", () => {
    expect(remoteContentDiffersFromStoreItem(blobItem, remote())).toBe(false);
  });

  it("applies a real CDN photo change on imported listings", () => {
    const imported = {
      ...blobItem,
      photos: ["https://i.ebayimg.com/images/g/xx/s-l500.jpg"],
    };
    expect(remoteContentDiffersFromStoreItem(imported, remote())).toBe(true);
  });
});
