import { describe, expect, it } from "vitest";
import { extractEbayItemPhotos, normalizeEbayPhotoUrl } from "./photos";

describe("normalizeEbayPhotoUrl", () => {
  it("upgrades http and protocol-relative URLs to https", () => {
    expect(normalizeEbayPhotoUrl("http://i.ebayimg.com/images/g/xx/s-l1600.jpg")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.jpg"
    );
    expect(normalizeEbayPhotoUrl("//i.ebayimg.com/images/g/xx/s-l1600.jpg")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.jpg"
    );
  });

  it("decodes XML entities", () => {
    expect(normalizeEbayPhotoUrl("https://i.ebayimg.com/images/g/a&amp;b/s-l1600.jpg")).toBe(
      "https://i.ebayimg.com/images/g/a&b/s-l2000.jpg"
    );
  });

  it("upgrades s-l thumbs and mid-size derivatives to s-l2000", () => {
    expect(normalizeEbayPhotoUrl("https://i.ebayimg.com/images/g/xx/s-l64.jpg")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.jpg"
    );
    expect(normalizeEbayPhotoUrl("https://i.ebayimg.com/images/g/xx/s-l500.webp")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.webp"
    );
    expect(normalizeEbayPhotoUrl("https://i.ebayimg.com/images/g/xx/s-l1600.jpg")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.jpg"
    );
    expect(normalizeEbayPhotoUrl("https://i.ebayimg.com/images/g/xx/s-l2000.jpg")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.jpg"
    );
  });

  it("rewrites /thumbs/ gallery URLs onto the full images path", () => {
    expect(
      normalizeEbayPhotoUrl("https://i.ebayimg.com/thumbs/images/g/g1/s-l140.jpg")
    ).toBe("https://i.ebayimg.com/images/g/g1/s-l2000.jpg");
  });

  it("rewrites EPS $_N.JPG URLs to the full-size images/g form", () => {
    expect(
      normalizeEbayPhotoUrl(
        "https://i.ebayimg.com/00/s/MTYwMFgxNjAw/z/pxcAAOSwis1hwW4V/$_12.JPG?set_id=8800005007"
      )
    ).toBe("https://i.ebayimg.com/images/g/pxcAAOSwis1hwW4V/s-l2000.jpg");
  });

  it("upgrades leftover EPS $_N URLs without a z/ hash to SuperSize", () => {
    expect(
      normalizeEbayPhotoUrl("https://i.ebayimg.com/00/s/ODAwWDYwMA==/foo/$_12.JPG")
    ).toBe("https://i.ebayimg.com/00/s/ODAwWDYwMA==/foo/$_57.JPG");
  });

  it("leaves non-eBay hosts unchanged", () => {
    expect(normalizeEbayPhotoUrl("https://blob.vercel-storage.com/clock.jpg")).toBe(
      "https://blob.vercel-storage.com/clock.jpg"
    );
  });
});

describe("extractEbayItemPhotos", () => {
  it("reads PictureURL values", () => {
    const xml = `
      <Item>
        <PictureDetails>
          <PictureURL>https://i.ebayimg.com/images/g/one/s-l500.jpg</PictureURL>
          <PictureURL>https://i.ebayimg.com/images/g/two/s-l500.jpg</PictureURL>
        </PictureDetails>
      </Item>`;
    expect(extractEbayItemPhotos(xml)).toEqual([
      "https://i.ebayimg.com/images/g/one/s-l2000.jpg",
      "https://i.ebayimg.com/images/g/two/s-l2000.jpg",
    ]);
  });

  it("falls back to GalleryURL when PictureURL is missing", () => {
    const xml = `
      <Item>
        <PictureDetails>
          <GalleryURL>https://i.ebayimg.com/thumbs/images/g/g1/s-l140.jpg</GalleryURL>
        </PictureDetails>
      </Item>`;
    expect(extractEbayItemPhotos(xml)).toEqual(["https://i.ebayimg.com/images/g/g1/s-l2000.jpg"]);
  });
});
