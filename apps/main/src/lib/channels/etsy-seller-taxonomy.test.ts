import { describe, expect, it } from "vitest";
import {
  ETSY_SELLER_TOP_LEVELS,
  listEtsySellerCategoryPaths,
  parseEtsySellerCategoryMarkdown,
} from "./etsy-seller-taxonomy";
import { planInwMappingForMarketplacePath } from "./category-resolver";

describe("parseEtsySellerCategoryMarkdown", () => {
  it("parses nested paths from seller help markdown format", () => {
    const sample = `
## Full list of categories

- Accessories
- - Adult Bibs
- Aprons
- Belts & Suspenders
- - Belt Buckles
- Belts
- Art & Collectibles
- - Collectibles
- - - Coins & Money
`;
    const paths = parseEtsySellerCategoryMarkdown(sample).map((p) => p.path);
    expect(paths).toContain("Accessories");
    expect(paths).toContain("Accessories > Aprons");
    expect(paths).toContain("Accessories > Belts & Suspenders > Belt Buckles");
    expect(paths).toContain("Art & Collectibles > Collectibles > Coins & Money");
  });
});

describe("listEtsySellerCategoryPaths", () => {
  it("loads hundreds of paths from bundled seller help export", () => {
    const paths = listEtsySellerCategoryPaths();
    expect(paths.length).toBeGreaterThan(500);
    expect(paths.some((p) => p.path.startsWith("Accessories"))).toBe(true);
    expect(paths.some((p) => p.path.includes("Coins & Money"))).toBe(true);
  });

  it("covers all Etsy top-level categories", () => {
    const tops = new Set(listEtsySellerCategoryPaths().filter((p) => p.depth === 0).map((p) => p.path));
    for (const top of ETSY_SELLER_TOP_LEVELS) {
      expect(tops.has(top)).toBe(true);
    }
  });
});

describe("planInwMappingForMarketplacePath — Etsy seller paths", () => {
  it("assigns preset subcategories for collectibles leaves", () => {
    const mapped = planInwMappingForMarketplacePath(
      "etsy",
      "Art & Collectibles > Collectibles > Coins & Money"
    );
    expect(mapped?.category).toBe("Art & Collectibles");
    expect(mapped?.subcategory).toBeTruthy();
  });

  it("assigns preset subcategories for accessories leaves", () => {
    const mapped = planInwMappingForMarketplacePath("etsy", "Accessories > Hats & Head Coverings > Hats & Caps");
    expect(mapped?.category).toBe("Accessories");
    expect(mapped?.subcategory).toMatch(/Hat|Cap|Other/i);
  });
});
