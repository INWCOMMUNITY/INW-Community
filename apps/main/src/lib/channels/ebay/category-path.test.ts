import { describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    channelCategoryMapping: { findFirst: vi.fn() },
  },
}));

import { isEbayTaxonomyRootCategoryError } from "./category-path";
import { EbayApiError } from "./errors";

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
