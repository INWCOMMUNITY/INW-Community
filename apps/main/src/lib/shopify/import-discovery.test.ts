import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findFirst: vi.fn() },
      shopifyListingLink: { findMany: vi.fn(), findFirst: vi.fn() },
    },
  };
});

vi.mock("./admin-graphql", () => ({
  executeShopifyAdminGraphql: vi.fn(),
}));

import { prisma } from "database";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { discoverShopifyImportCandidates } from "./import-discovery";

describe("discoverShopifyImportCandidates", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockReset();
    vi.mocked(prisma.shopifyListingLink.findMany).mockReset();
    vi.mocked(executeShopifyAdminGraphql).mockReset();
  });

  it("returns CONNECTION_REQUIRED without an active connection", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(null as never);
    const result = await discoverShopifyImportCandidates({ memberId: "member-a" });
    expect(result).toMatchObject({ status: "ERROR", code: "CONNECTION_REQUIRED" });
  });

  it("excludes mapped products and marks multi-variant unsupported", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.shopifyListingLink.findMany).mockResolvedValue([
      { shopifyProductId: "gid://shopify/Product/100" },
    ] as never);
    vi.mocked(executeShopifyAdminGraphql).mockResolvedValue({
      ok: true,
      class: "SUCCESS",
      httpStatus: 200,
      requestId: null,
      errors: null,
      cost: null,
      outcomeUnknown: false,
      message: "ok",
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Product/100",
              title: "Already mapped",
              descriptionHtml: "",
              status: "ACTIVE",
              hasOnlyDefaultVariant: true,
              totalVariants: 1,
              featuredImage: null,
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    price: "10.00",
                    sku: "A",
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/1",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 3 }] },
                    },
                  },
                ],
              },
            },
            {
              id: "gid://shopify/Product/200",
              title: "Multi",
              descriptionHtml: "",
              status: "ACTIVE",
              hasOnlyDefaultVariant: false,
              totalVariants: 2,
              featuredImage: null,
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/2",
                    price: "12.00",
                    sku: "B",
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/2",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 1 }] },
                    },
                  },
                  {
                    id: "gid://shopify/ProductVariant/3",
                    price: "13.00",
                    sku: "C",
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/3",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 1 }] },
                    },
                  },
                ],
              },
            },
            {
              id: "gid://shopify/Product/300",
              title: "Simple mug",
              descriptionHtml: "<p>Nice</p>",
              status: "ACTIVE",
              hasOnlyDefaultVariant: true,
              totalVariants: 1,
              featuredImage: { url: "https://cdn.example/mug.jpg" },
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/4",
                    price: "15.00",
                    sku: "MUG1",
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/4",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 10 }] },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const result = await discoverShopifyImportCandidates({ memberId: "member-a" });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.candidates.map((c) => c.shopifyProductId)).toEqual([
      "gid://shopify/Product/200",
      "gid://shopify/Product/300",
    ]);
    const multi = result.candidates.find((c) => c.shopifyProductId.endsWith("/200"))!;
    expect(multi.supported).toBe(false);
    expect(multi.unsupportedReason).toContain("Multiple variants");
    const simple = result.candidates.find((c) => c.shopifyProductId.endsWith("/300"))!;
    expect(simple.supported).toBe(true);
    expect(simple.priceCents).toBe(1500);
    expect(simple.primaryLocationAvailable).toBe(10);
    expect(simple.recommendedStockMode).toBe("PHYSICAL");
  });

  it("fails safely on invalid provider responses", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(executeShopifyAdminGraphql).mockResolvedValue({
      ok: false,
      class: "GRAPHQL_PERMANENT",
      httpStatus: 200,
      requestId: null,
      data: null,
      errors: [{ message: "boom" }],
      cost: null,
      outcomeUnknown: false,
      message: "GraphQL permanent failure",
    });
    const result = await discoverShopifyImportCandidates({ memberId: "member-a" });
    expect(result).toMatchObject({ status: "ERROR", code: "PROVIDER_ERROR" });
  });
});
