import { describe, expect, it } from "vitest";
import { shopifyProductSetFileInputs, toShopifyMediaSourceUrls } from "./listing-media-urls";

describe("listing media URL helpers", () => {
  it("keeps ordered absolute HTTPS URLs and drops duplicates", () => {
    expect(
      toShopifyMediaSourceUrls([
        "https://cdn.example/a.jpg",
        "https://cdn.example/a.jpg",
        "https://cdn.example/b.jpg",
      ])
    ).toEqual(["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]);
  });

  it("upgrades http to https and builds productSet file inputs", () => {
    expect(toShopifyMediaSourceUrls(["http://cdn.example/a.jpg"])).toEqual([
      "https://cdn.example/a.jpg",
    ]);
    expect(shopifyProductSetFileInputs(["https://cdn.example/a.jpg"])).toEqual([
      {
        originalSource: "https://cdn.example/a.jpg",
        contentType: "IMAGE",
        alt: "Photo 1",
      },
    ]);
  });
});
