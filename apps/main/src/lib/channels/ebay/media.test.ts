import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  ebayJson: vi.fn(),
  ebayGet: vi.fn(),
}));

import { ebayGet, ebayJson } from "./client";
import {
  isEbayImageRelatedInventoryError,
  normalizeInventoryImageUrls,
  putInventoryWithPhotoRecovery,
  sanitizeInventoryImageUrl,
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
      "https://i.ebayimg.com/images/g/xx/s-l140.jpg"
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

  it("re-hosts eBay CDN photos after #25014", async () => {
    mockedJson.mockResolvedValue({ imageId: "img-1" });
    mockedGet.mockResolvedValue({ imageUrl: "https://i.ebayimg.com/hosted.jpg" });
    const put = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "[#25014 · API_INVENTORY · Request · HTTP 400] The eBay listing associated with the inventory item, or the unpublished offer has invalid pictures."
        )
      )
      .mockResolvedValueOnce(undefined);
    await putInventoryWithPhotoRecovery({
      accessToken: "t",
      body: { product: { title: "X", imageUrls: ["https://i.ebayimg.com/old.jpg"] } },
      put,
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(
      (put.mock.calls[1]?.[0] as { product: { imageUrls: string[] } }).product.imageUrls
    ).toEqual(["https://i.ebayimg.com/hosted.jpg"]);
  });

  it("falls back to INW photos when live picture hosting still fails", async () => {
    mockedJson
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ imageId: "img-2" });
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
