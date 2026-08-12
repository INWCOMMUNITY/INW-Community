import { describe, expect, it } from "vitest";
import { resolveInwCategoryFromRemote } from "./category-resolver";
import {
  ebayCategoryPathCandidatesWithMeta,
  aliasSpecificityScore,
} from "./ebay-category-aliases";

describe("ebayCategoryPathCandidatesWithMeta — specificity metadata", () => {
  it("generates candidates with correct depth for 3-level path", () => {
    const candidates = ebayCategoryPathCandidatesWithMeta("Collectibles > Comics > Modern Age");
    
    // Should include the full path, various combinations, and individual segments
    expect(candidates.length).toBeGreaterThan(3);
    
    // Full path should have highest depth
    const fullPath = candidates.find(c => c.segment === "Collectibles > Comics > Modern Age");
    expect(fullPath).toBeDefined();
    expect(fullPath?.components).toBe(3);
    
    // Comics segment should exist
    const comics = candidates.find(c => c.segment === "Comics");
    expect(comics).toBeDefined();
    expect(comics?.components).toBe(1);
    
    // Hierarchical combo "Comics > Modern Age" should exist
    const comicsModern = candidates.find(c => c.segment === "Comics > Modern Age");
    expect(comicsModern).toBeDefined();
    expect(comicsModern?.components).toBe(2);
  });

  it("includes hierarchical combinations for multi-level paths", () => {
    const candidates = ebayCategoryPathCandidatesWithMeta(
      "Clothing, Shoes & Accessories > Women's Clothing > Dresses"
    );
    
    // Should include "Women's Clothing > Dresses"
    const womensDresses = candidates.find(
      c => c.normalized.includes("women") && c.normalized.includes("dresses")
    );
    expect(womensDresses).toBeDefined();
  });
});

describe("aliasSpecificityScore — scoring hierarchical matches", () => {
  it("scores hierarchical aliases higher than single-segment aliases", () => {
    const candidates = ebayCategoryPathCandidatesWithMeta("Collectibles > Comics");
    const collectiblesCandidate = candidates.find(c => c.segment === "Collectibles")!;
    const comicsCandidate = candidates.find(c => c.segment === "Comics")!;
    const fullPathCandidate = candidates.find(c => c.segment === "Collectibles > Comics")!;
    
    // Hierarchical key should score higher than single-segment keys
    const hierarchicalScore = aliasSpecificityScore("collectibles > comics", fullPathCandidate);
    const collectiblesScore = aliasSpecificityScore("collectibles", collectiblesCandidate);
    const comicsScore = aliasSpecificityScore("comics", comicsCandidate);
    
    expect(hierarchicalScore).toBeGreaterThan(collectiblesScore);
    expect(hierarchicalScore).toBeGreaterThan(comicsScore);
  });
});

describe("resolveInwCategoryFromRemote — eBay hierarchical path priority", () => {
  it("maps Collectibles > Comics to Books, Movies & Music (not Art & Collectibles)", () => {
    const r = resolveInwCategoryFromRemote(
      "Collectibles > Comics > Modern Age (1992-Now)",
      null,
      { provider: "ebay" }
    );
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Books, Movies & Music");
    expect(r?.subcategory).toBe("Comics & Graphic Novels");
  });

  it("maps Collectibles > Comic Books & Memorabilia correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Collectibles > Comic Books & Memorabilia > Comics",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Books, Movies & Music");
    expect(r?.subcategory).toBe("Comics & Graphic Novels");
  });

  it("maps manga under Comics correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Collectibles > Comics > Manga",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Books, Movies & Music");
    expect(r?.subcategory).toBe("Comics & Graphic Novels");
  });

  it("maps Collectibles > Trading Cards to Art & Collectibles", () => {
    const r = resolveInwCategoryFromRemote(
      "Collectibles > Trading Cards > Sports Trading Cards",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Art & Collectibles");
    expect(r?.subcategory).toBe("Trading Cards");
  });

  it("maps Collectibles > Animation Art correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Collectibles > Animation Art & Characters > Animation Art",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Art & Collectibles");
    expect(r?.subcategory).toBe("Animation Art");
  });

  it("maps Collectibles > Sports Memorabilia correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Collectibles > Sports Memorabilia > Autographed Items",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Art & Collectibles");
    expect(r?.subcategory).toBe("Sports Memorabilia");
  });

  it("maps generic Collectibles to Art & Collectibles when no specific path", () => {
    const r = resolveInwCategoryFromRemote("Collectibles", null, { provider: "ebay" });
    expect(r?.category).toBe("Art & Collectibles");
  });

  it("maps Antiques > Furniture to Furniture > Vintage & Antique", () => {
    const r = resolveInwCategoryFromRemote(
      "Antiques > Furniture > Beds & Bedroom Sets",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Furniture");
    expect(r?.subcategory).toBe("Vintage & Antique");
  });

  it("maps Home & Garden > Kitchen to Home & Kitchen", () => {
    const r = resolveInwCategoryFromRemote(
      "Home & Garden > Kitchen, Dining & Bar > Cookware",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Home & Kitchen");
    expect(r?.subcategory).toBe("Cookware & Bakeware");
  });

  it("maps Toys & Hobbies > Action Figures to Toys & Games", () => {
    const r = resolveInwCategoryFromRemote(
      "Toys & Hobbies > Action Figures > TV, Movie & Video Games",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Toys & Games");
    expect(r?.subcategory).toBe("Action Figures & Collectibles");
  });

  it("maps Sporting Goods > Golf correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Sporting Goods > Golf > Golf Clubs & Equipment",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Sports & Outdoors");
    expect(r?.subcategory).toBe("Golf");
  });

  it("maps Baby > Nursery Furniture correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Baby > Nursery Furniture > Cribs & Cradles",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Baby & Kids");
    expect(r?.subcategory).toBe("Nursery Furniture");
  });

  it("maps Video Games under Consumer Electronics correctly", () => {
    const r = resolveInwCategoryFromRemote(
      "Video Games & Consoles > Video Games",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Books, Movies & Music");
    expect(r?.subcategory).toBe("Video Games");
  });
});

describe("resolveInwCategoryFromRemote — Etsy auto-translate", () => {
  it("maps Etsy top-level Home & Living", () => {
    const r = resolveInwCategoryFromRemote("Home & Living", "Wall Decor", { provider: "etsy" });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Home & Living");
  });

  it("maps Etsy Jewelry → Jewelry & Watches", () => {
    const r = resolveInwCategoryFromRemote("Jewelry", "Earrings", { provider: "etsy" });
    expect(r?.category).toBe("Jewelry & Watches");
    expect(r?.subcategory).toBe("Earrings");
  });

  it("maps Etsy Paper & Party Supplies", () => {
    const r = resolveInwCategoryFromRemote("Paper & Party Supplies", "Greeting Cards", {
      provider: "etsy",
    });
    expect(r?.category).toBe("Paper & Party Supplies");
    expect(r?.subcategory).toBe("Greeting Cards");
  });

  it("maps Etsy Weddings → Wedding", () => {
    const r = resolveInwCategoryFromRemote("Weddings", null, { provider: "etsy" });
    expect(r?.category).toBe("Wedding");
  });

  it("maps Etsy Books, Films & Music", () => {
    const r = resolveInwCategoryFromRemote("Books, Films & Music", null, { provider: "etsy" });
    expect(r?.category).toBe("Books, Movies & Music");
  });

  it("picks closest preset for unfamiliar leaf labels", () => {
    const r = resolveInwCategoryFromRemote("Accessories", "Fascinators", { provider: "etsy" });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Accessories");
  });
});

describe("resolveInwCategoryFromRemote — Wix auto-translate", () => {
  it("ignores productType physical", () => {
    const r = resolveInwCategoryFromRemote("physical", null, { provider: "wix" });
    expect(r).toBeNull();
  });

  it("maps Wix collection Jewelry", () => {
    const r = resolveInwCategoryFromRemote("Jewelry", null, { provider: "wix" });
    expect(r?.category).toBe("Jewelry & Watches");
  });

  it("maps Wix apparel → Clothing", () => {
    const r = resolveInwCategoryFromRemote("Apparel", null, { provider: "wix" });
    expect(r?.category).toBe("Clothing");
  });

  it("ignores marketing collections via noise when only label", () => {
    const r = resolveInwCategoryFromRemote("New Arrivals", null, { provider: "wix" });
    expect(r).toBeNull();
  });

  it("closest-matches a ribbon like Skin Care", () => {
    const r = resolveInwCategoryFromRemote("Skin Care", null, { provider: "wix" });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Bath & Beauty");
    expect(r?.subcategory).toBe("Skin Care");
  });
});

describe("resolveInwCategoryFromRemote — eBay auto-translate", () => {
  it("maps eBay women's clothing path", () => {
    const r = resolveInwCategoryFromRemote(
      "Clothing, Shoes & Accessories > Women's Clothing",
      null,
      { provider: "ebay" }
    );
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Clothing");
    expect(r?.subcategory).toBe("Women's Clothing");
  });

  it("maps eBay coins path to Art & Collectibles", () => {
    const r = resolveInwCategoryFromRemote(
      "Coins & Paper Money > Coins: US",
      null,
      { provider: "ebay" }
    );
    expect(r?.category).toBe("Art & Collectibles");
    expect(r?.subcategory).toBe("Coins & Currency");
  });

  it("maps eBay Home & Garden decor via closest preset", () => {
    const r = resolveInwCategoryFromRemote("Home & Garden > Home Décor", null, {
      provider: "ebay",
    });
    expect(r?.matchedPreset).toBe(true);
    expect(r?.category).toBe("Home & Living");
  });

  it("maps eBay Business & Industrial root", () => {
    const r = resolveInwCategoryFromRemote("Business & Industrial", null, { provider: "ebay" });
    expect(r?.category).toBe("Business & Industrial");
  });

  it("maps eBay tickets root", () => {
    const r = resolveInwCategoryFromRemote("Tickets & Experiences", null, { provider: "ebay" });
    expect(r?.category).toBe("Tickets & Experiences");
  });
});
