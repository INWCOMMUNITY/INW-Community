import { describe, expect, it } from "vitest";
import { listingDisplayPhoto, listingDisplayPhotos } from "./listing-display-photo";

describe("listingDisplayPhoto", () => {
  it("rewrites eBay s-l2000 to the display long-edge", () => {
    const src = "https://i.ebayimg.com/images/g/xx/s-l2000.jpg";
    expect(listingDisplayPhoto(src, "thumb")).toBe("https://i.ebayimg.com/images/g/xx/s-l225.jpg");
    expect(listingDisplayPhoto(src, "card")).toBe("https://i.ebayimg.com/images/g/xx/s-l800.jpg");
    expect(listingDisplayPhoto(src, "hero")).toBe("https://i.ebayimg.com/images/g/xx/s-l1600.jpg");
  });

  it("leaves blob and other hosts unchanged", () => {
    const blob = "https://qaz.public.blob.vercel-storage.com/clock.jpg";
    expect(listingDisplayPhoto(blob, "card")).toBe(blob);
  });

  it("rewrites Wix media to a fit derivative and leaves lightbox originals to the caller", () => {
    const src = "https://static.wixstatic.com/media/abc123~mv2.jpg";
    expect(listingDisplayPhoto(src, "thumb")).toBe(
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fit/w_225,h_225,al_c,q_80,enc_auto/abc123~mv2.jpg"
    );
    expect(listingDisplayPhoto(src, "card")).toBe(
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fit/w_800,h_800,al_c,q_80,enc_auto/abc123~mv2.jpg"
    );
    expect(listingDisplayPhoto(src, "hero")).toBe(
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fit/w_1600,h_1600,al_c,q_80,enc_auto/abc123~mv2.jpg"
    );
  });

  it("strips an existing Wix fill before applying the display size", () => {
    const src =
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80/abc123~mv2.jpg";
    expect(listingDisplayPhoto(src, "card")).toBe(
      "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fit/w_800,h_800,al_c,q_80,enc_auto/abc123~mv2.jpg"
    );
  });

  it("returns null for empty input", () => {
    expect(listingDisplayPhoto(null, "card")).toBeNull();
    expect(listingDisplayPhoto("", "card")).toBeNull();
  });
});

describe("listingDisplayPhotos", () => {
  it("keeps the first N photos and sizes them", () => {
    const photos = [
      "https://i.ebayimg.com/images/g/a/s-l2000.jpg",
      "https://i.ebayimg.com/images/g/b/s-l2000.jpg",
      "https://i.ebayimg.com/images/g/c/s-l2000.jpg",
    ];
    expect(listingDisplayPhotos(photos, "card", 2)).toEqual([
      "https://i.ebayimg.com/images/g/a/s-l800.jpg",
      "https://i.ebayimg.com/images/g/b/s-l800.jpg",
    ]);
  });
});
