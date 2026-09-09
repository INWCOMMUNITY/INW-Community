import { describe, expect, it } from "vitest";
import { shopifyTaxonomyGidForInw } from "./taxonomy";
import { getOutboundCategoryMapping, shopifyProductTypeForInw } from "../category-suggest";

describe("shopifyTaxonomyGidForInw", () => {
  it("maps Video Games consoles to the Standard Product Taxonomy GID", () => {
    expect(shopifyTaxonomyGidForInw("Video Games & Consoles", "Consoles")).toBe(
      "gid://shopify/TaxonomyCategory/el-19-2"
    );
  });

  it("maps Food & Drink bakery to a food taxonomy GID", () => {
    expect(shopifyTaxonomyGidForInw("Food & Drink", "Baked Goods")).toBe(
      "gid://shopify/TaxonomyCategory/fb-2-1"
    );
  });

  it("falls back to the top-level GID", () => {
    expect(shopifyTaxonomyGidForInw("Clothing", "Women's Clothing")).toBe(
      "gid://shopify/TaxonomyCategory/aa-1"
    );
  });

  it("maps remaining INW tops to confirmed taxonomy GIDs", () => {
    expect(shopifyTaxonomyGidForInw("Home & Garden")).toBe("gid://shopify/TaxonomyCategory/hg");
    expect(shopifyTaxonomyGidForInw("Home & Kitchen")).toBe("gid://shopify/TaxonomyCategory/hg-11");
    expect(shopifyTaxonomyGidForInw("Toys & Games")).toBe("gid://shopify/TaxonomyCategory/tg");
    expect(shopifyTaxonomyGidForInw("Sports & Outdoors", "Camping & Hiking")).toBe(
      "gid://shopify/TaxonomyCategory/sg-4-2"
    );
    expect(shopifyTaxonomyGidForInw("Office & School Supplies")).toBe(
      "gid://shopify/TaxonomyCategory/os"
    );
    expect(shopifyTaxonomyGidForInw("Luggage & Travel")).toBe("gid://shopify/TaxonomyCategory/lb");
    expect(shopifyTaxonomyGidForInw("Books, Movies & Music")).toBe(
      "gid://shopify/TaxonomyCategory/me"
    );
    expect(shopifyTaxonomyGidForInw("Vehicles & Parts")).toBe("gid://shopify/TaxonomyCategory/vp");
  });
});

describe("shopifyProductTypeForInw", () => {
  it("returns a merchant product type for new tops", () => {
    expect(shopifyProductTypeForInw("Video Games & Consoles", "Games (physical)")).toBe(
      "Video Games"
    );
    expect(shopifyProductTypeForInw("Food & Drink")).toBe("Food & Drink");
    expect(shopifyProductTypeForInw("Food & Drink", "Baked Goods")).toBe("Bakery");
    expect(shopifyProductTypeForInw("Musical Instruments")).toBe("Musical Instruments");
    expect(shopifyProductTypeForInw("Tools & Home Improvement")).toBe("Tools");
  });
});

describe("getOutboundCategoryMapping", () => {
  it("maps remaining INW tops to eBay and Etsy IDs", () => {
    expect(getOutboundCategoryMapping("Food & Drink", null, "ebay")).toMatchObject({
      categoryId: "14308",
    });
    expect(getOutboundCategoryMapping("Musical Instruments", null, "ebay")).toMatchObject({
      categoryId: "619",
    });
    expect(getOutboundCategoryMapping("Vehicles & Parts", null, "ebay")).toMatchObject({
      categoryId: "6000",
    });
    expect(getOutboundCategoryMapping("Home & Garden", null, "ebay")).toMatchObject({
      categoryId: "20697",
    });
    expect(getOutboundCategoryMapping("Furniture", "Living Room", "etsy")).toMatchObject({
      categoryId: 436,
    });
    expect(getOutboundCategoryMapping("Home & Kitchen", null, "etsy")).toMatchObject({
      categoryId: 430,
    });
    expect(getOutboundCategoryMapping("Luggage & Travel", null, "etsy")).toMatchObject({
      categoryId: 311,
    });
  });
});
