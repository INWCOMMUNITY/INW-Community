import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    shopifyListingLink: { findMany: vi.fn() },
    storeItem: { findMany: vi.fn() },
  },
}));

import { prisma } from "database";
import { listEligibleShopifyExportListings } from "./eligible-listings";

describe("listEligibleShopifyExportListings", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyListingLink.findMany).mockReset();
    vi.mocked(prisma.storeItem.findMany).mockReset();
  });

  it("includes multi-variant items as supported and excludes mapped ones", async () => {
    vi.mocked(prisma.shopifyListingLink.findMany).mockResolvedValue([
      { storeItemId: "mapped-1" },
    ] as never);
    vi.mocked(prisma.storeItem.findMany).mockResolvedValue([
      {
        id: "simple-1",
        title: "Simple",
        slug: "simple",
        sku: "SKU1",
        priceCents: 1000,
        quantity: 3,
        status: "active",
        updatedAt: new Date("2026-09-28T00:00:00.000Z"),
        storeVariants: [{ id: "v1" }],
      },
      {
        id: "multi-1",
        title: "Multi",
        slug: "multi",
        sku: null,
        priceCents: 2000,
        quantity: 1,
        status: "active",
        updatedAt: new Date("2026-09-28T00:00:00.000Z"),
        storeVariants: [{ id: "v2" }, { id: "v3" }],
      },
    ] as never);

    const rows = await listEligibleShopifyExportListings({
      memberId: "member-a",
      connectionId: "conn-1",
    });

    expect(prisma.shopifyListingLink.findMany).toHaveBeenCalledWith({
      where: { shopifyConnectionId: "conn-1", memberId: "member-a" },
      select: { storeItemId: true },
    });
    expect(prisma.storeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: "member-a",
          status: "active",
          id: { notIn: ["mapped-1"] },
        }),
      })
    );
    expect(rows).toEqual([
      {
        storeItemId: "simple-1",
        title: "Simple",
        slug: "simple",
        sku: "SKU1",
        priceCents: 1000,
        quantity: 3,
        status: "active",
        updatedAt: "2026-09-28T00:00:00.000Z",
        variantCount: 1,
        supported: true,
        unsupportedReason: null,
      },
      {
        storeItemId: "multi-1",
        title: "Multi",
        slug: "multi",
        sku: null,
        priceCents: 2000,
        quantity: 1,
        status: "active",
        updatedAt: "2026-09-28T00:00:00.000Z",
        variantCount: 2,
        supported: true,
        unsupportedReason: null,
      },
    ]);
  });

  it("marks zero-variant listings unsupported", async () => {
    vi.mocked(prisma.shopifyListingLink.findMany).mockResolvedValue([]);
    vi.mocked(prisma.storeItem.findMany).mockResolvedValue([
      {
        id: "empty-1",
        title: "Empty",
        slug: "empty",
        sku: null,
        priceCents: 500,
        quantity: 0,
        status: "active",
        updatedAt: new Date("2026-09-28T00:00:00.000Z"),
        storeVariants: [],
      },
    ] as never);

    const rows = await listEligibleShopifyExportListings({
      memberId: "member-a",
      connectionId: "conn-1",
    });
    expect(rows[0]).toMatchObject({
      storeItemId: "empty-1",
      supported: false,
      unsupportedReason: "Listing has no active variants",
    });
  });

  it("does not apply notIn when there are no mappings", async () => {
    vi.mocked(prisma.shopifyListingLink.findMany).mockResolvedValue([]);
    vi.mocked(prisma.storeItem.findMany).mockResolvedValue([]);
    await listEligibleShopifyExportListings({
      memberId: "member-a",
      connectionId: "conn-1",
    });
    expect(prisma.storeItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: "member-a", status: "active" },
      })
    );
  });
});
