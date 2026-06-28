import { describe, expect, it } from "vitest";
import { extractEbayItemPhotos, normalizeEbayPhotoUrl } from "./photos";

describe("normalizeEbayPhotoUrl", () => {
  it("upgrades http and protocol-relative URLs to https", () => {
    expect(normalizeEbayPhotoUrl("http://i.ebayimg.com/foo.jpg")).toBe(
      "https://i.ebayimg.com/foo.jpg"
    );
    expect(normalizeEbayPhotoUrl("//i.ebayimg.com/foo.jpg")).toBe("https://i.ebayimg.com/foo.jpg");
  });

  it("decodes XML entities", () => {
    expect(normalizeEbayPhotoUrl("https://i.ebayimg.com/a&amp;b.jpg")).toBe(
      "https://i.ebayimg.com/a&b.jpg"
    );
  });
});

describe("extractEbayItemPhotos", () => {
  it("reads PictureURL values", () => {
    const xml = `
      <Item>
        <PictureDetails>
          <PictureURL>https://i.ebayimg.com/one.jpg</PictureURL>
          <PictureURL>https://i.ebayimg.com/two.jpg</PictureURL>
        </PictureDetails>
      </Item>`;
    expect(extractEbayItemPhotos(xml)).toEqual([
      "https://i.ebayimg.com/one.jpg",
      "https://i.ebayimg.com/two.jpg",
    ]);
  });

  it("falls back to GalleryURL when PictureURL is missing", () => {
    const xml = `
      <Item>
        <PictureDetails>
          <GalleryURL>https://i.ebayimg.com/thumbs/images/g/g1/s-l140.jpg</GalleryURL>
        </PictureDetails>
      </Item>`;
    expect(extractEbayItemPhotos(xml)).toEqual(["https://i.ebayimg.com/thumbs/images/g/g1/s-l500.jpg"]);
  });
});
