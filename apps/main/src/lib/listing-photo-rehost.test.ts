import { describe, expect, it } from "vitest";
import { shouldCopyMarketplacePhotosToInw } from "./listing-photo-rehost";

describe("shouldCopyMarketplacePhotosToInw", () => {
  it("copies Shopify-only galleries onto INW once", () => {
    expect(
      shouldCopyMarketplacePhotosToInw(["https://cdn.shopify.com/s/files/1/clock.jpg"])
    ).toBe(true);
  });

  it("does not recopy when INW already hosts a photo", () => {
    expect(
      shouldCopyMarketplacePhotosToInw([
        "https://abc.public.blob.vercel-storage.com/clock.jpg",
        "https://cdn.shopify.com/s/files/1/clock.jpg",
      ])
    ).toBe(false);
  });

  it("skips empty lists", () => {
    expect(shouldCopyMarketplacePhotosToInw([])).toBe(false);
  });
});
