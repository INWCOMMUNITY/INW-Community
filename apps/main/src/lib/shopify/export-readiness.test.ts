import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    shopifyConnection: { findFirst: vi.fn() },
    storeItem: { findFirst: vi.fn() },
  },
  lookupShopifyListingByStoreItem: vi.fn(),
  SHOPIFY_MAX_OPTION_DIMENSIONS: 3,
  SHOPIFY_MAX_VARIANTS: 100,
}));

import { lookupShopifyListingByStoreItem, prisma } from "database";
import { getShopifyExportReadiness } from "./export-readiness";

describe("getShopifyExportReadiness", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(lookupShopifyListingByStoreItem).mockReset();
  });

  it("blocks when Shopify is not connected", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(null as never);
    const result = await getShopifyExportReadiness({
      memberId: "m1",
      storeItemId: "item-1",
    });
    expect(result.canList).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain("CONNECTION_REQUIRED");
  });

  it("blocks when primary location is missing", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      primaryLocationId: null,
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Mug",
      storeVariants: [{ id: "v1", options: {}, priceCents: 1000 }],
    } as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({ status: "UNMAPPED" } as never);

    const result = await getShopifyExportReadiness({
      memberId: "m1",
      storeItemId: "item-1",
    });
    expect(result.canList).toBe(false);
    expect(result.locationSelectionRequired).toBe(true);
    expect(result.blockers.map((b) => b.code)).toContain("LOCATION_REQUIRED");
  });

  it("blocks already-mapped listings and surfaces product id", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Mug",
      storeVariants: [{ id: "v1", options: {}, priceCents: 1000 }],
    } as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({
      status: "MAPPED",
      listingLink: { shopifyProductId: "gid://shopify/Product/9" },
    } as never);

    const result = await getShopifyExportReadiness({
      memberId: "m1",
      storeItemId: "item-1",
    });
    expect(result.canList).toBe(false);
    expect(result.alreadyMapped).toBe(true);
    expect(result.shopifyProductId).toBe("gid://shopify/Product/9");
    expect(result.blockers.map((b) => b.code)).toContain("ALREADY_MAPPED");
  });

  it("blocks when option axes exceed Shopify limit", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Shirt",
      storeVariants: [
        {
          id: "v1",
          options: { Size: "M", Color: "Red", Material: "Cotton", Fit: "Slim" },
          priceCents: 2000,
        },
        {
          id: "v2",
          options: { Size: "L", Color: "Red", Material: "Cotton", Fit: "Slim" },
          priceCents: 2000,
        },
      ],
    } as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({ status: "UNMAPPED" } as never);

    const result = await getShopifyExportReadiness({
      memberId: "m1",
      storeItemId: "item-1",
    });
    expect(result.canList).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain("UNSUPPORTED_VARIANTS");
  });

  it("allows a ready active listing", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Mug",
      storeVariants: [{ id: "v1", options: {}, priceCents: 1000 }],
    } as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({ status: "UNMAPPED" } as never);

    const result = await getShopifyExportReadiness({
      memberId: "m1",
      storeItemId: "item-1",
    });
    expect(result.canList).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});
