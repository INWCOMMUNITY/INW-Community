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
      first.desired.map((row, index) => ({
        inwMediaId: row.inwMediaId,
        sourceUrl: row.sourceUrl,
        status: "ACTIVE" as const,
        position: row.position,
        shopifyMediaId: `gid://shopify/MediaImage/${index + 1}`,
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

  it("reuses position-matched identity when source URL drifted to CDN", () => {
    const first = planShopifyMediaDesireFromPhotos(["https://cdn.example/blob.jpg"], []);
    const afterCdnRewrite = planShopifyMediaDesireFromPhotos(["https://cdn.example/blob.jpg"], [
      {
        inwMediaId: first.desired[0].inwMediaId,
        sourceUrl: "https://cdn.shopify.com/s/files/rewritten.jpg",
        status: "ACTIVE",
        position: 0,
        shopifyMediaId: "gid://shopify/MediaImage/1",
      },
    ]);
    expect(afterCdnRewrite.desired[0].inwMediaId).toBe(first.desired[0].inwMediaId);
    expect(afterCdnRewrite.toAdd).toHaveLength(0);
    expect(afterCdnRewrite.toRemove).toHaveLength(0);
  });

  it("retries create when ACTIVE map has no Shopify GID", () => {
    const first = planShopifyMediaDesireFromPhotos(["https://cdn.example/a.jpg"], []);
    const retry = planShopifyMediaDesireFromPhotos(["https://cdn.example/a.jpg"], [
      {
        inwMediaId: first.desired[0].inwMediaId,
        sourceUrl: "https://cdn.example/a.jpg",
        status: "ACTIVE",
        position: 0,
        shopifyMediaId: null,
      },
    ]);
    expect(retry.toAdd).toHaveLength(1);
    expect(retry.toAdd[0].inwMediaId).toBe(first.desired[0].inwMediaId);
    expect(retry.toReorder).toHaveLength(0);
    expect(retry.desired[0].inwMediaId).toBe(first.desired[0].inwMediaId);
  });

  it("marks removed photos without recycling identity", () => {
    const first = planShopifyMediaDesireFromPhotos(["https://cdn.example/a.jpg"], []);
    const second = planShopifyMediaDesireFromPhotos([], [
      {
        inwMediaId: first.desired[0].inwMediaId,
        sourceUrl: "https://cdn.example/a.jpg",
        status: "ACTIVE",
        position: 0,
        shopifyMediaId: "gid://shopify/MediaImage/1",
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
