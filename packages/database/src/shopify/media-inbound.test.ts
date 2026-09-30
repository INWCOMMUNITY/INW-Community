import { describe, expect, it } from "vitest";
import { matchRemoteShopifyMediaToMaps, shopifyMediaContentSha256 } from "./media-map";

describe("media inbound duplicate protection", () => {
  it("matches by Media GID so CDN URL change does not invent a new identity", () => {
    const sha = shopifyMediaContentSha256("https://cdn.example/old.jpg");
    const result = matchRemoteShopifyMediaToMaps({
      maps: [
        {
          inwMediaId: "media-1",
          shopifyMediaId: "gid://shopify/MediaImage/1",
          contentSha256: sha,
          sourceUrl: "https://cdn.example/old.jpg",
          status: "ACTIVE",
        },
      ],
      remote: [
        {
          shopifyMediaId: "gid://shopify/MediaImage/1",
          sourceUrl: "https://cdn.example/new-cdn-path.jpg",
        },
      ],
    });
    expect(result.matched).toEqual([
      { inwMediaId: "media-1", shopifyMediaId: "gid://shopify/MediaImage/1" },
    ]);
    expect(result.unmatchedRemote).toHaveLength(0);
  });

  it("leaves unmatched remote for durable ingest (not URL-only invent)", () => {
    const result = matchRemoteShopifyMediaToMaps({
      maps: [],
      remote: [{ shopifyMediaId: "gid://shopify/MediaImage/9", sourceUrl: "https://cdn.example/a.jpg" }],
    });
    expect(result.unmatchedRemote).toHaveLength(1);
    expect(result.matched).toHaveLength(0);
  });
});
