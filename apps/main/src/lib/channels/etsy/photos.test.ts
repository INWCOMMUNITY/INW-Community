import { describe, expect, it } from "vitest";
import {
  inwPhotoUrlsMatch,
  planEtsyPhotoReplaceOrder,
  planEtsyPhotoSync,
  readLastPushedPhotos,
} from "./photos";

const etsy = (ids: number[]) =>
  ids.map((listing_image_id, i) => ({
    listing_image_id,
    rank: i + 1,
    url_fullxfull: `https://i.etsystatic.com/${listing_image_id}.jpg`,
  }));

describe("planEtsyPhotoSync", () => {
  const inw = [
    "https://blob.example.com/a.jpg",
    "https://blob.example.com/b.jpg",
    "https://blob.example.com/c.jpg",
  ];

  it("does not re-upload when INW photo URLs match the last push", () => {
    expect(
      planEtsyPhotoSync({
        inwPhotos: inw,
        etsyImages: etsy([1, 2, 3]),
        lastPushedInwPhotos: inw,
      })
    ).toEqual({
      uploadUrls: [],
      deleteBeforeUpload: [],
      deleteAfterUpload: [],
    });
  });

  it("does not append all INW photos on a title-only update with no snapshot", () => {
    const plan = planEtsyPhotoSync({
      inwPhotos: inw,
      etsyImages: etsy([1, 2, 3]),
      lastPushedInwPhotos: null,
    });
    expect(plan.uploadUrls).toEqual([]);
    expect(plan.deleteAfterUpload).toEqual([]);
  });

  it("trims extras that were appended by a previous doubling push", () => {
    const plan = planEtsyPhotoSync({
      inwPhotos: inw,
      etsyImages: etsy([1, 2, 3, 4, 5, 6]),
      lastPushedInwPhotos: null,
    });
    expect(plan.uploadUrls).toEqual([]);
    expect(plan.deleteAfterUpload).toEqual([4, 5, 6]);
  });

  it("replaces Etsy images when INW photos actually changed", () => {
    const next = ["https://blob.example.com/new.jpg", "https://blob.example.com/b.jpg"];
    const plan = planEtsyPhotoSync({
      inwPhotos: next,
      etsyImages: etsy([1, 2, 3]),
      lastPushedInwPhotos: inw,
    });
    expect(plan.uploadUrls).toEqual(next);
    expect(plan.deleteAfterUpload).toEqual([1, 2, 3]);
    expect(plan.deleteBeforeUpload).toEqual([]);
  });

  it("does not replace Etsy images when GetItem overwrote INW blobs with marketplace CDNs", () => {
    const plan = planEtsyPhotoSync({
      inwPhotos: [
        "https://i.ebayimg.com/images/g/one/s-l2000.jpg",
        "https://i.etsystatic.com/67230490/il_fullxfull.1.jpg",
      ],
      etsyImages: etsy([1, 2, 3]),
      lastPushedInwPhotos: inw,
    });
    expect(plan).toEqual({
      uploadUrls: [],
      deleteBeforeUpload: [],
      deleteAfterUpload: [],
    });
  });

  it("uploads only the new tail when Etsy has fewer images and there is no snapshot", () => {
    const plan = planEtsyPhotoSync({
      inwPhotos: inw,
      etsyImages: etsy([1]),
      lastPushedInwPhotos: null,
    });
    expect(plan.uploadUrls).toEqual([
      "https://blob.example.com/b.jpg",
      "https://blob.example.com/c.jpg",
    ]);
    expect(plan.deleteAfterUpload).toEqual([]);
  });
});

describe("planEtsyPhotoReplaceOrder", () => {
  it("deletes old images first when the listing is already at the 10-image cap", () => {
    const images = etsy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const order = planEtsyPhotoReplaceOrder(images, 4);
    expect(order.deleteBeforeUpload).toHaveLength(4);
    expect(order.deleteAfterUpload).toHaveLength(6);
    expect(new Set([...order.deleteBeforeUpload, ...order.deleteAfterUpload]).size).toBe(10);
  });
});

describe("readLastPushedPhotos", () => {
  it("reads a JSON string array", () => {
    expect(readLastPushedPhotos(["https://a.jpg", "https://b.jpg"])).toEqual([
      "https://a.jpg",
      "https://b.jpg",
    ]);
    expect(readLastPushedPhotos(null)).toBeNull();
    expect(inwPhotoUrlsMatch(["a"], ["a"])).toBe(true);
    expect(inwPhotoUrlsMatch(["a"], ["b"])).toBe(false);
  });
});
