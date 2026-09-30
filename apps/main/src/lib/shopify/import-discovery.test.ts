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

  it("excludes mapped products and supports multi-variant candidates", async () => {
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
              options: [{ name: "Title", position: 1, values: ["Default Title"] }],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    price: "10.00",
                    sku: "A",
                    selectedOptions: [{ name: "Title", value: "Default Title" }],
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
              title: "Multi-variant Shirt",
              descriptionHtml: "<p>A shirt</p>",
              status: "ACTIVE",
              hasOnlyDefaultVariant: false,
              totalVariants: 2,
              featuredImage: null,
              options: [{ name: "Size", position: 1, values: ["S", "M"] }],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/2",
                    price: "12.00",
                    sku: "SHIRT-S",
                    selectedOptions: [{ name: "Size", value: "S" }],
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/2",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 5 }] },
                    },
                  },
                  {
                    id: "gid://shopify/ProductVariant/3",
                    price: "13.00",
                    sku: "SHIRT-M",
                    selectedOptions: [{ name: "Size", value: "M" }],
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/3",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 8 }] },
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
              options: [{ name: "Title", position: 1, values: ["Default Title"] }],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/4",
                    price: "15.00",
                    sku: "MUG1",
                    selectedOptions: [{ name: "Title", value: "Default Title" }],
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

    // Multi-variant is now supported
    const multi = result.candidates.find((c) => c.shopifyProductId.endsWith("/200"))!;
    expect(multi.supported).toBe(true);
    expect(multi.variants).toHaveLength(2);
    expect(multi.axes).toHaveLength(1);
    expect(multi.axes[0].name).toBe("Size");
    expect(multi.matrix).toBeTruthy();
    expect(multi.priceCents).toBe(1200);

    // Simple product still works
    const simple = result.candidates.find((c) => c.shopifyProductId.endsWith("/300"))!;
    expect(simple.supported).toBe(true);
    expect(simple.priceCents).toBe(1500);
    expect(simple.primaryLocationAvailable).toBe(10);
    expect(simple.recommendedStockMode).toBe("PHYSICAL");
    expect(simple.variants).toHaveLength(0);
  });

  it("rejects products with >3 option dimensions", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.shopifyListingLink.findMany).mockResolvedValue([] as never);
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
              id: "gid://shopify/Product/400",
              title: "Too many options",
              descriptionHtml: "",
              status: "ACTIVE",
              hasOnlyDefaultVariant: false,
              totalVariants: 4,
              featuredImage: null,
              options: [
                { name: "Color", position: 1, values: ["Red"] },
                { name: "Size", position: 2, values: ["S"] },
                { name: "Material", position: 3, values: ["Cotton"] },
                { name: "Style", position: 4, values: ["V-Neck"] },
              ],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/10",
                    price: "10.00",
                    sku: null,
                    selectedOptions: [
                      { name: "Color", value: "Red" },
                      { name: "Size", value: "S" },
                      { name: "Material", value: "Cotton" },
                      { name: "Style", value: "V-Neck" },
                    ],
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/10",
                      tracked: true,
                      requiresShipping: true,
                      inventoryLevel: { quantities: [{ name: "available", quantity: 1 }] },
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
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].supported).toBe(false);
    expect(result.candidates[0].unsupportedReason).toContain("option dimensions");
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
