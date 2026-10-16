import { describe, expect, it } from "vitest";
import {
  applySharedShopifyAvailability,
  listingSharesOnePrice,
  shopifyVariantPriceCents,
} from "./product-set-listing";

describe("Shopify shared listing push", () => {
  it("sends the one pool to every combination instead of summing them", () => {
    const available = new Map<string, number>([
      ["black", 25],
      ["blue", 25],
      ["brown", 24],
    ]);
    applySharedShopifyAvailability(available, [
      { variantId: "black", storeItemId: "item", shared: true },
      { variantId: "blue", storeItemId: "item", shared: true },
      { variantId: "brown", storeItemId: "item", shared: true },
    ]);
    expect([...available.values()]).toEqual([24, 24, 24]);
  });

  it("leaves per-combination quantities alone when stock varies", () => {
    const available = new Map<string, number>([
      ["small", 3],
      ["large", 8],
    ]);
    applySharedShopifyAvailability(available, [
      { variantId: "small", storeItemId: "item", shared: false },
      { variantId: "large", storeItemId: "item", shared: false },
    ]);
    expect([...available.values()]).toEqual([3, 8]);
  });

  it("uses the listing price when prices do not vary", () => {
    expect(listingSharesOnePrice({ pricesVary: false, sharedQuantity: true })).toBe(true);
    expect(
      shopifyVariantPriceCents({
        variantPriceCents: 1800,
        listingPriceCents: 4000,
        pricesVary: false,
      })
    ).toBe(4000);
    expect(
      shopifyVariantPriceCents({
        variantPriceCents: 1800,
        listingPriceCents: 4000,
        pricesVary: true,
      })
    ).toBe(1800);
  });
});
