import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  ebayJson: vi.fn(),
  ebayGet: vi.fn(),
}));

import { ebayGet, ebayJson } from "./client";
import {
  isEbayImageRelatedInventoryError,
  isEbayMixedHostPictureError,
  normalizeInventoryImageUrls,
  applyEbayInventoryPhotoPolicy,
  putInventoryWithPhotoRecovery,
  sanitizeInventoryImageUrl,
  selectPassthroughInventoryImageUrls,
} from "./media";

const mockedJson = vi.mocked(ebayJson);
const mockedGet = vi.mocked(ebayGet);

describe("isEbayImageRelatedInventoryError", () => {
  it("detects image-related inventory errors", () => {
    expect(isEbayImageRelatedInventoryError("Invalid image URL supplied.")).toBe(true);
    expect(isEbayImageRelatedInventoryError("Missing required aspect Year")).toBe(false);
    expect(
      isEbayImageRelatedInventoryError(
        "[#25014 · API_INVENTORY · Request · HTTP 400] The eBay listing associated with the inventory item, or the unpublished offer has invalid pictures."
      )
    ).toBe(true);
  });
});

describe("sanitizeInventoryImageUrl", () => {
  it("upgrades http and protocol-relative URLs without changing eBay CDN size", () => {
    expect(sanitizeInventoryImageUrl("http://i.ebayimg.com/images/g/xx/s-l140.jpg")).toBe(
      "https://i.ebayimg.com/images/g/xx/s-l2000.jpg"
    );
    expect(sanitizeInventoryImageUrl("//cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(sanitizeInventoryImageUrl("ftp://x")).toBeNull();
  });
});

describe("normalizeInventoryImageUrls", () => {
  it("dedupes and keeps at most 12 https URLs", () => {
    expect(
      normalizeInventoryImageUrls([
        "http://cdn.example.com/a.jpg",
        "https://cdn.example.com/a.jpg",
        "not-a-url",
      ])
    ).toEqual(["https://cdn.example.com/a.jpg"]);
  });
});

describe("putInventoryWithPhotoRecovery", () => {
  beforeEach(() => {
    mockedJson.mockReset();
    mockedGet.mockReset();
  });

  it("does not upload INW photos when the seller did not change them", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: { product: { title: "X", imageUrls: ["https://blob.example.com/a.jpg"] } },
      liveImageUrls: ["https://i.ebayimg.com/live.jpg"],
      allowInwPhotoUpload: false,
      fallbackImageUrls: ["https://blob.example.com/a.jpg"],
      put,
    });
    expect(mockedJson).not.toHaveBeenCalled();
    expect(
      (put.mock.calls[0]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/live.jpg"]);
  });

  it("hosts non-eBay photos before the first PUT", async () => {
    mockedJson.mockResolvedValue({ imageId: "img-1" });
    mockedGet.mockResolvedValue({ imageUrl: "https://i.ebayimg.com/hosted.jpg" });
    const put = vi.fn().mockResolvedValue(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: { product: { title: "X", imageUrls: ["https://blob.example.com/a.jpg"] } },
      put,
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(
      (put.mock.calls[0]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/hosted.jpg"]);
  });

  it("drops self-hosted URLs from a mixed payload before PUT", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: {
        product: {
          title: "X",
          imageUrls: ["https://i.ebayimg.com/eps.jpg", "https://blob.example.com/a.jpg"],
        },
      },
      put,
    });
    expect(mockedJson).not.toHaveBeenCalled();
    expect(
      (put.mock.calls[0]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/eps.jpg"]);
  });

  it("pins live EPS instead of overlaying INW blobs", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: { product: { title: "X", imageUrls: ["https://blob.example.com/a.jpg"] } },
      liveImageUrls: ["https://i.ebayimg.com/live.jpg"],
      fallbackImageUrls: ["https://blob.example.com/a.jpg"],
      put,
    });
    expect(mockedJson).not.toHaveBeenCalled();
    expect(
      (put.mock.calls[0]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/live.jpg"]);
  });

  it("upgrades live EPS thumbs to meet the 500px Picture Policy", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: { product: { title: "X", imageUrls: ["https://blob.example.com/a.jpg"] } },
      liveImageUrls: ["https://i.ebayimg.com/images/g/xx/s-l140.jpg"],
      put,
    });
    expect(
      (put.mock.calls[0]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/images/g/xx/s-l2000.jpg"]);
  });

  it("does not send EPS URLs through Media API after #25014", async () => {
    const put = vi.fn().mockRejectedValue(
      new Error(
        "[#25014 · API_INVENTORY · Request · HTTP 400] The eBay listing associated with the inventory item, or the unpublished offer has invalid pictures."
      )
    );
    await expect(
      putInventoryWithPhotoRecovery({
        accessToken: "t",
        body: { product: { title: "X", imageUrls: ["https://i.ebayimg.com/old.jpg"] } },
        put,
      })
    ).rejects.toThrow(/#25014/);
    expect(mockedJson).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("falls back to INW photos when live picture hosting still fails", async () => {
    mockedJson.mockResolvedValueOnce({ imageId: "img-2" });
    mockedGet.mockResolvedValue({ imageUrl: "https://i.ebayimg.com/inw.jpg" });
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error("[#25014] invalid pictures"))
      .mockResolvedValueOnce(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: { product: { title: "X", imageUrls: ["https://i.ebayimg.com/old.jpg"] } },
      fallbackImageUrls: ["https://cdn.inw.example/item.jpg"],
      put,
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(
      (put.mock.calls[1]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/inw.jpg"]);
  });
});

describe("applyEbayInventoryPhotoPolicy", () => {
  it("keeps live EPS and drops INW blobs when photos were not edited", () => {
    const next = applyEbayInventoryPhotoPolicy(
      { product: { title: "X", imageUrls: ["https://blob.example.com/a.jpg"] } },
      {
        liveImageUrls: ["https://i.ebayimg.com/live.jpg"],
        inwPhotos: ["https://blob.example.com/a.jpg"],
        pushInwPhotos: false,
      }
    );
    expect((next.product as { imageUrls: string[] }).imageUrls).toEqual([
      "https://i.ebayimg.com/live.jpg",
    ]);
  });

  it("omits imageUrls when photos were not edited and eBay has none to pin", () => {
    const next = applyEbayInventoryPhotoPolicy(
      { product: { title: "X", imageUrls: ["https://blob.example.com/a.jpg"] } },
      {
        liveImageUrls: [],
        inwPhotos: ["https://blob.example.com/a.jpg"],
        pushInwPhotos: false,
      }
    );
    expect(next.product).not.toHaveProperty("imageUrls");
  });
});

describe("selectPassthroughInventoryImageUrls", () => {
  it("keeps live EPS when INW photos are self-hosted", () => {
    expect(
      selectPassthroughInventoryImageUrls(
        ["https://i.ebayimg.com/live.jpg"],
        ["https://blob.example.com/a.jpg"]
      )
    ).toEqual(["https://i.ebayimg.com/live.jpg"]);
  });
});

describe("isEbayMixedHostPictureError", () => {
  it("detects the EPS mix message", () => {
    expect(
      isEbayMixedHostPictureError(
        "A mixture of Self Hosted and EPS pictures are not allowed."
      )
    ).toBe(true);
    expect(isEbayMixedHostPictureError("Invalid image URL supplied.")).toBe(false);
  });
});
