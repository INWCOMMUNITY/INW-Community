import { describe, expect, it } from "vitest";
import { isFeedPostRenderable } from "./feed-post-visible";
import { isListingFeedCollectionPublicItem } from "./listing-feed-collection-constants";
import { isStoreItemPubliclyPurchasable, storeItemRowsToFeedEmbedMap } from "./store-item-variants";

const emptyPost = {
  type: "shared_store_item",
  content: null,
  photos: [] as string[],
  videos: [] as string[],
  links: null,
  sourceBlogId: null,
  sourcePostId: null,
  sourceBusinessId: null,
  sourceCouponId: null,
  sourceStoreItemId: "item-1",
  sourceEventId: null,
};

describe("active marketplace / feed discovery after End", () => {
  it("A. inactive listings are not publicly purchasable", () => {
    expect(isStoreItemPubliclyPurchasable({ status: "inactive", quantity: 4 })).toBe(false);
    expect(isStoreItemPubliclyPurchasable({ status: "active", quantity: 4 })).toBe(true);
  });

  it("A. feed embeds omit inactive/ended StoreItems", () => {
    const map = storeItemRowsToFeedEmbedMap([
      {
        id: "ended",
        title: "Ended",
        slug: "ended",
        photos: ["https://example.com/a.jpg"],
        priceCents: 1000,
        status: "inactive",
        quantity: 4,
      },
      {
        id: "live",
        title: "Live",
        slug: "live",
        photos: ["https://example.com/b.jpg"],
        priceCents: 2000,
        status: "active",
        quantity: 1,
      },
    ]);
    expect(map.ended).toBeUndefined();
    expect(map.live).toMatchObject({ id: "live", slug: "live" });
  });

  it("A. listing-feed collections omit ended items but keep sold_out", () => {
    expect(isListingFeedCollectionPublicItem("inactive")).toBe(false);
    expect(isListingFeedCollectionPublicItem("active")).toBe(true);
    expect(isListingFeedCollectionPublicItem("sold_out")).toBe(true);
  });

  it("B. shared_store_item feed posts without a buyable embed are not renderable", () => {
    expect(
      isFeedPostRenderable({
        ...emptyPost,
        sourceStoreItem: undefined,
      })
    ).toBe(false);
    expect(
      isFeedPostRenderable({
        ...emptyPost,
        sourceStoreItem: { id: "live", title: "Live", slug: "live" },
      })
    ).toBe(true);
  });

  it("B. listing-collection feed cards with no remaining visible items are not renderable", () => {
    expect(
      isFeedPostRenderable({
        ...emptyPost,
        type: "shared_listing_collection",
        sourceStoreItemId: null,
        sourceListingCollectionId: "col-1",
        sourceListingCollection: { itemCount: 0 },
      })
    ).toBe(false);
    expect(
      isFeedPostRenderable({
        ...emptyPost,
        type: "shared_listing_collection",
        sourceStoreItemId: null,
        sourceListingCollectionId: "col-1",
        sourceListingCollection: { itemCount: 2 },
      })
    ).toBe(true);
  });

  it("E. relist restores active discovery eligibility", () => {
    expect(isStoreItemPubliclyPurchasable({ status: "active", quantity: 1 })).toBe(true);
    expect(isListingFeedCollectionPublicItem("active")).toBe(true);
  });

  it("F. sold_out stays distinct from ended/inactive", () => {
    expect(isStoreItemPubliclyPurchasable({ status: "sold_out", quantity: 0 })).toBe(false);
    expect(isListingFeedCollectionPublicItem("sold_out")).toBe(true);
    expect(isListingFeedCollectionPublicItem("inactive")).toBe(false);
  });
});
