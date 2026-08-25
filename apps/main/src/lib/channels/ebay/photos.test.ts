import { describe, expect, it } from "vitest";
import { extractEbayItemPhotos, normalizeEbayPhotoUrl, shouldApplyEbayInboundPhotos } from "./photos";

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

  it("keeps EPS PictureURLs and drops Etsy ExternalPictureURL echoes", () => {
    const xml = `
      <Item>
        <PictureDetails>
          <PictureURL>https://i.ebayimg.com/images/g/one/s-l500.jpg</PictureURL>
          <ExternalPictureURL>https://i.etsystatic.com/67230490/r/il/638602/8475142285/il_fullxfull.8475142285</ExternalPictureURL>
        </PictureDetails>
      </Item>`;
    expect(extractEbayItemPhotos(xml)).toEqual(["https://i.ebayimg.com/images/g/one/s-l2000.jpg"]);
  });

  it("drops Etsy PictureURLs when any EPS URL is present", () => {
    const xml = `
      <Item>
        <PictureDetails>
          <PictureURL>https://i.etsystatic.com/67230490/r/il/638602/8475142285/il_fullxfull.8475142285</PictureURL>
          <PictureURL>https://i.ebayimg.com/00/s/MTYwMFgxNDcw/z/SHEAAeSw3vtqjNEh/$_1.JPG</PictureURL>
        </PictureDetails>
      </Item>`;
    expect(extractEbayItemPhotos(xml)).toEqual([
      "https://i.ebayimg.com/images/g/SHEAAeSw3vtqjNEh/s-l2000.jpg",
    ]);
  });
});

describe("shouldApplyEbayInboundPhotos", () => {
  const eps = ["https://i.ebayimg.com/images/g/one/s-l2000.jpg"];
  const blob = ["https://blob.vercel-storage.com/clock.jpg"];

  it("fills INW when it has no photos yet", () => {
    expect(shouldApplyEbayInboundPhotos({ incoming: eps, current: [] })).toBe(true);
  });

  it("does not overwrite existing INW photos on cron GetItem", () => {
    expect(shouldApplyEbayInboundPhotos({ incoming: eps, current: blob })).toBe(false);
  });

  it("does not overwrite INW Blob photos with EPS, even on force refresh", () => {
    expect(shouldApplyEbayInboundPhotos({ incoming: eps, current: blob, force: true })).toBe(false);
  });

  it("upgrades imported eBay thumbs to s-l2000 on cron", () => {
    expect(
      shouldApplyEbayInboundPhotos({
        incoming: ["https://i.ebayimg.com/images/g/one/s-l2000.jpg"],
        current: ["https://i.ebayimg.com/images/g/one/s-l500.jpg"],
      })
    ).toBe(true);
  });

  it("does not apply foreign CDN-only photos even on force", () => {
    expect(
      shouldApplyEbayInboundPhotos({
        incoming: ["https://i.etsystatic.com/67230490/il_fullxfull.1.jpg"],
        current: blob,
        force: true,
      })
    ).toBe(false);
  });
});
