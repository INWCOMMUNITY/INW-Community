import { describe, expect, it } from "vitest";
import {
  matchRemoteShopifyMediaToMaps,
  planShopifyMediaDesireFromPhotos,
  shopifyMediaContentSha256,
} from "./media-map";

describe("planShopifyMediaDesireFromPhotos", () => {
  it("reuses durable identity when source URL is unchanged", () => {
    const first = planShopifyMediaDesireFromPhotos(
      ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      []
    );
    expect(first.desired).toHaveLength(2);
    expect(first.toAdd).toHaveLength(2);

    const second = planShopifyMediaDesireFromPhotos(
      ["https://cdn.example/b.jpg", "https://cdn.example/a.jpg"],
      first.desired.map((row) => ({
        inwMediaId: row.inwMediaId,
        sourceUrl: row.sourceUrl,
        status: "ACTIVE" as const,
        position: row.position,
      }))
    );
    expect(second.toAdd).toHaveLength(0);
    expect(second.toRemove).toHaveLength(0);
    expect(second.toReorder).toHaveLength(2);
    expect(second.desired.map((r) => r.inwMediaId)).toEqual([
      first.desired[1].inwMediaId,
      first.desired[0].inwMediaId,
    ]);
  });

  it("marks removed photos without recycling identity", () => {
    const first = planShopifyMediaDesireFromPhotos(["https://cdn.example/a.jpg"], []);
    const second = planShopifyMediaDesireFromPhotos([], [
      {
        inwMediaId: first.desired[0].inwMediaId,
        sourceUrl: "https://cdn.example/a.jpg",
        status: "ACTIVE",
        position: 0,
      },
    ]);
    expect(second.toRemove).toEqual([first.desired[0].inwMediaId]);
    expect(second.desired).toHaveLength(0);
  });
});

describe("matchRemoteShopifyMediaToMaps", () => {
  it("matches by Shopify GID first, then content hash — never URL-only invent", () => {
    const sha = shopifyMediaContentSha256("https://cdn.example/a.jpg");
    const result = matchRemoteShopifyMediaToMaps({
      maps: [
        {
          inwMediaId: "media-1",
          shopifyMediaId: "gid://shopify/MediaImage/1",
          contentSha256: sha,
          sourceUrl: "https://cdn.example/a.jpg",
          status: "ACTIVE",
        },
        {
          inwMediaId: "media-2",
          shopifyMediaId: null,
          contentSha256: shopifyMediaContentSha256("https://cdn.example/b.jpg"),
          sourceUrl: "https://cdn.example/b.jpg",
          status: "PENDING_REMOTE",
        },
      ],
      remote: [
        { shopifyMediaId: "gid://shopify/MediaImage/1", sourceUrl: "https://other/a.jpg" },
        { shopifyMediaId: "gid://shopify/MediaImage/2", sourceUrl: "https://cdn.example/b.jpg" },
        { shopifyMediaId: "gid://shopify/MediaImage/3", sourceUrl: "https://cdn.example/c.jpg" },
      ],
    });
    expect(result.matched).toEqual([
      { inwMediaId: "media-1", shopifyMediaId: "gid://shopify/MediaImage/1" },
      { inwMediaId: "media-2", shopifyMediaId: "gid://shopify/MediaImage/2" },
    ]);
    expect(result.unmatchedRemote).toEqual([
      { shopifyMediaId: "gid://shopify/MediaImage/3", sourceUrl: "https://cdn.example/c.jpg" },
    ]);
  });
});
