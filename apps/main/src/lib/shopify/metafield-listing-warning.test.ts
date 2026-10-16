import { describe, expect, it } from "vitest";
import {
  listingNeedsShopifyMetafields,
  shopifyMetafieldListingWarning,
} from "./metafield-listing-warning";

describe("listingNeedsShopifyMetafields", () => {
  it("is true for a text box, choice list, or file upload", () => {
    expect(listingNeedsShopifyMetafields([{ kind: "TEXT", title: "Engraving" }])).toBe(true);
    expect(listingNeedsShopifyMetafields([{ kind: "DROPDOWN", title: "Font" }])).toBe(true);
    expect(listingNeedsShopifyMetafields([{ kind: "FILE", title: "Artwork" }])).toBe(true);
  });

  it("ignores blank custom options", () => {
    expect(listingNeedsShopifyMetafields([{ kind: "TEXT", title: "  " }])).toBe(false);
    expect(listingNeedsShopifyMetafields([])).toBe(false);
    expect(listingNeedsShopifyMetafields(null)).toBe(false);
  });
});

describe("shopifyMetafieldListingWarning", () => {
  it("names one item or several", () => {
    expect(shopifyMetafieldListingWarning()).toContain("listing this item to Shopify");
    expect(shopifyMetafieldListingWarning(3)).toContain("listing these items to Shopify");
  });
});
