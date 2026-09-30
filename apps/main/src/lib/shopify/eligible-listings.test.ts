import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyListingLink: { findMany: vi.fn() },
      storeItem: { findMany: vi.fn() },
    },
  };
});

import { prisma } from "database";
import { listEligibleShopifyExportListings } from "./eligible-listings";

describe("listEligibleShopifyExportListings", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyListingLink.findMany).mockReset();
    vi.mocked(prisma.storeItem.findMany).mockReset();
  });

  it("excludes already-mapped listings and includes single + multi-variant items", async () => {
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
        storeVariants: [{ id: "v1", options: null }],
      },
      {
        id: "multi-1",
        title: "Multi",
        slug: "multi",
        sku: null,
        priceCents: 2000,
        quantity: 5,
        status: "active",
        updatedAt: new Date("2026-09-28T00:00:00.000Z"),
        storeVariants: [
          { id: "v2", options: JSON.stringify({ Size: "S" }) },
          { id: "v3", options: JSON.stringify({ Size: "M" }) },
        ],
      },
      {
        id: "too-many-axes",
        title: "TooManyAxes",
        slug: "too-many",
        sku: null,
        priceCents: 3000,
        quantity: 1,
        status: "active",
        updatedAt: new Date("2026-09-28T00:00:00.000Z"),
        storeVariants: [
          {
            id: "v4",
            options: JSON.stringify({ A: "1", B: "2", C: "3", D: "4" }),
          },
          {
            id: "v5",
            options: JSON.stringify({ A: "1", B: "2", C: "3", D: "5" }),
          },
        ],
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
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      storeItemId: "simple-1",
      title: "Simple",
      variantCount: 1,
    });
    expect(rows[1]).toMatchObject({
      storeItemId: "multi-1",
      title: "Multi",
      variantCount: 2,
    });
  });

  it("does not apply notIn when there are no mappings", async () => {
    vi.mocked(prisma.shopifyListingLink.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.storeItem.findMany).mockResolvedValue([] as never);
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
