import { describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    channelCategoryMapping: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { ebayGetItemCategoryLabelIsUsable, getEbayCategoryPathFromId, isEbayTaxonomyRootCategoryError } from "./category-path";
import { EbayApiError } from "./errors";
import * as client from "./client";

describe("isEbayTaxonomyRootCategoryError", () => {
  it("matches eBay 62008 root-tree subtree errors", () => {
    expect(
      isEbayTaxonomyRootCategoryError(
        new EbayApiError(
          "[#62008 · API_TAXONOMY · REQUEST · HTTP 400] The specified category ID is the root for the category tree.",
          400,
          null,
          "/get_category_subtree"
        )
      )
    ).toBe(true);
    expect(isEbayTaxonomyRootCategoryError(new Error("boom"))).toBe(false);
  });
});

describe("getEbayCategoryPathFromId", () => {
  it("uses the GetItem category name instead of walking Taxonomy", async () => {
    const ebayGet = vi.spyOn(client, "ebayGet");
    await expect(
      getEbayCategoryPathFromId(
        "261605",
        "Collectibles:Decorative Collectibles:Clocks:Desk, Mantel & Shelf Clocks"
      )
    ).resolves.toBe("Collectibles:Decorative Collectibles:Clocks:Desk, Mantel & Shelf Clocks");
    expect(ebayGet).not.toHaveBeenCalled();
    expect(ebayGetItemCategoryLabelIsUsable("Clocks")).toBe(true);
  });
});
