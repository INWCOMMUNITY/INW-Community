import { describe, expect, it } from "vitest";
import {
  normalizeCategoryMatchKey,
  normalizeCategoryPathKey,
  priorityForMatchType,
} from "./channel-category-mapping";
import { buildChannelCategoryMappingSeedRows } from "./channel-mapping-seed";

describe("normalizeCategoryMatchKey", () => {
  it("normalizes comics path segments consistently", () => {
    expect(normalizeCategoryPathKey("Collectibles > Comics > Modern Age (1992-Now)")).toBe(
      "collectibles > comics > modern age 1992 now"
    );
  });

  it("matches ebay alias key normalization", () => {
    expect(normalizeCategoryMatchKey("Comics & Graphic Novels")).toBe(
      "comics and graphic novels"
    );
  });
});

describe("priorityForMatchType", () => {
  it("ranks category_id above path above label", () => {
    expect(priorityForMatchType("category_id", "123")).toBeGreaterThan(
      priorityForMatchType("path", "collectibles > comics")
    );
    expect(priorityForMatchType("path", "collectibles > comics")).toBeGreaterThan(
      priorityForMatchType("label", "comics")
    );
  });
});

describe("buildChannelCategoryMappingSeedRows", () => {
  it(
    "includes ebay comic path mappings with preset subcategories",
    async () => {
      const rows = await buildChannelCategoryMappingSeedRows();
      const comicPath = rows.find(
        (r) =>
          r.provider === "ebay" &&
          r.matchType === "path" &&
          r.matchKey === normalizeCategoryPathKey("collectibles > comics")
      );
      expect(comicPath).toBeDefined();
      expect(comicPath?.inwCategory).toBe("Books, Movies & Music");
      expect(comicPath?.inwSubcategory).toBe("Comics & Graphic Novels");
    },
    120_000
  );

  it(
    "includes hundreds of Etsy seller help path rows with subcategories",
    async () => {
      const rows = await buildChannelCategoryMappingSeedRows();
      const etsyPaths = rows.filter((r) => r.provider === "etsy" && r.matchType === "path");
      expect(etsyPaths.length).toBeGreaterThan(500);
      const withSub = etsyPaths.filter((r) => r.inwSubcategory);
      expect(withSub.length).toBeGreaterThan(400);
    },
    120_000
  );

  it(
    "includes eBay reference category_id rows for top-level categories",
    async () => {
      const rows = await buildChannelCategoryMappingSeedRows();
      const collectibles = rows.find(
        (r) => r.provider === "ebay" && r.matchType === "category_id" && r.matchKey === "1"
      );
      expect(collectibles).toBeDefined();
      expect(collectibles?.inwCategory).toBeTruthy();
    },
    120_000
  );
});
