import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  shopifyGraphql: vi.fn(),
}));

import { shopifyGraphql } from "./client";
import { fetchShopifyProductTaxonomyMaps } from "./inbound-taxonomy";

const gql = vi.mocked(shopifyGraphql);

describe("fetchShopifyProductTaxonomyMaps", () => {
  it("indexes Admin Category fullName by REST product id", async () => {
    gql.mockResolvedValueOnce({
      products: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: "gid://shopify/Product/11",
            legacyResourceId: "11",
            category: {
              id: "gid://shopify/TaxonomyCategory/aa-1-3",
              fullName: "Apparel & Accessories > Clothing > T-Shirts",
            },
          },
        ],
      },
    });

    const map = await fetchShopifyProductTaxonomyMaps("tok", "shop.myshopify.com", "2024-10");
    expect(map.get("11")).toEqual({
      fullName: "Apparel & Accessories > Clothing > T-Shirts",
      gid: "gid://shopify/TaxonomyCategory/aa-1-3",
    });
  });

  it("returns an empty map when GraphQL fails", async () => {
    gql.mockRejectedValueOnce(new Error("access denied"));
    const map = await fetchShopifyProductTaxonomyMaps("tok", "shop.myshopify.com", "2024-10");
    expect(map.size).toBe(0);
  });
});
