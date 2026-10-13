import { beforeEach, describe, expect, it, vi } from "vitest";

const { etsyConnectionRequest } = vi.hoisted(() => ({
  etsyConnectionRequest: vi.fn(),
}));

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: (...args: unknown[]) => etsyConnectionRequest(...args),
}));

vi.mock("../shopify/reconcile-listing", () => ({
  pushStoreItemTopologyToShopifyNow: vi.fn(async () => undefined),
  pushUnmappedStoreVariantsToShopify: vi.fn(async () => undefined),
}));

vi.mock("database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("database")>();
  return {
    applyFoundationSellerCollapseToSimple: vi.fn(async () => ({})),
    applyFoundationSellerMatrixStructure: vi.fn(async () => ({})),
    captureEtsyInventoryProjectionDesire: vi.fn(async () => ({})),
    etsyCentsFromMoney: vi.fn(() => 0),
    replaceEtsyListingVariantMaps: vi.fn(async () => undefined),
    recordEtsyListingVariantTopologyDesire: vi.fn(async () => ({ status: "RECORDED" })),
    recordShopifyListingVariantTopologyDesire: vi.fn(async () => undefined),
    marketplaceTopologyMatchKey: actual.marketplaceTopologyMatchKey,
    STALE_MARKETPLACE_QTY_REVERT_MS: 10 * 60 * 1000,
    prisma: {
      etsyVariantMap: { findMany: vi.fn(async () => []) },
      etsySyncJob: { findFirst: vi.fn(async () => null) },
      storeVariant: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    },
  };
});

import {
  localVariantComboKeys,
  mapsMatchLocalCombos,
  remoteProductComboKeys,
  syncEtsyListingVariantTopology,
} from "./sync-listing-variants";

describe("etsy Size×Color topology helpers", () => {
  it("builds stable local combo keys for Size×Color", () => {
    const keys = localVariantComboKeys([
      { id: "v1", options: { Size: "S", Color: "Red" }, priceCents: 1000, sku: null },
      { id: "v2", options: { Color: "Blue", Size: "M" }, priceCents: 1200, sku: null },
    ]);
    expect(keys).toEqual([
      "color=blue|size=m",
      "color=red|size=s",
    ]);
  });

  it("detects map/local option mismatch", () => {
    const variants = [
      { id: "v1", options: { Size: "S", Color: "Red" }, priceCents: 1000, sku: null },
      { id: "v2", options: { Size: "M", Color: "Blue" }, priceCents: 1200, sku: null },
    ];
    expect(
      mapsMatchLocalCombos({
        maps: [
          {
            storeVariantId: "v1",
            propertyValuesJson: [
              { property_name: "Size", values: ["S"] },
              { property_name: "Color", values: ["Red"] },
            ],
          },
          {
            storeVariantId: "v2",
            propertyValuesJson: [
              { property_name: "Size", values: ["M"] },
              { property_name: "Color", values: ["Blue"] },
            ],
          },
        ],
        variants,
      })
    ).toBe(true);

    expect(
      mapsMatchLocalCombos({
        maps: [
          {
            storeVariantId: "v1",
            propertyValuesJson: [
              { property_name: "Size", values: ["S"] },
              { property_name: "Color", values: ["Green"] },
            ],
          },
        ],
        variants,
      })
    ).toBe(false);
  });

  it("treats Color vs Primary color map labels as matching via values", () => {
    const variants = [
      { id: "v1", options: { Size: "S", "Primary color": "Red" }, priceCents: 1000, sku: null },
    ];
    expect(
      mapsMatchLocalCombos({
        maps: [
          {
            storeVariantId: "v1",
            propertyValuesJson: [
              { property_name: "Size", values: ["S"] },
              { property_name: "Color", values: ["Red"] },
            ],
          },
        ],
        variants,
      })
    ).toBe(true);
  });

  it("reads remote product combo keys from property_values", () => {
    const keys = remoteProductComboKeys([
      {
        product_id: 1,
        property_values: [
          { property_name: "Size", values: ["S"] },
          { property_name: "Color", values: ["Red"] },
        ],
      },
      {
        product_id: 2,
        property_values: [
          { property_name: "Color", values: ["Blue"] },
          { property_name: "Size", values: ["M"] },
        ],
      },
    ]);
    expect(keys).toEqual(["color=blue|size=m", "color=red|size=s"]);
  });
});

describe("Etsy variant add fans out to Shopify", () => {
  beforeEach(() => {
    etsyConnectionRequest.mockReset();
  });

  it("adopts a new Etsy size into INW and records a Shopify topology push", async () => {
    const { prisma, recordShopifyListingVariantTopologyDesire, applyFoundationSellerMatrixStructure } =
      await import("database");
    const { pushStoreItemTopologyToShopifyNow } = await import("../shopify/reconcile-listing");
    vi.mocked(recordShopifyListingVariantTopologyDesire).mockClear();
    vi.mocked(applyFoundationSellerMatrixStructure).mockClear();
    vi.mocked(pushStoreItemTopologyToShopifyNow).mockClear();
    vi.mocked(prisma.storeVariant.findMany)
      .mockResolvedValueOnce([
        {
          id: "sv-simple",
          options: null,
          priceCents: 1000,
          sku: null,
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
          inventoryState: { mode: "TRACKED_FINITE", onHand: 4, reserved: 0 },
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "sv-simple",
          options: null,
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ] as never)
      .mockResolvedValueOnce([
        { id: "sv-s", options: { Size: "S" } },
        { id: "sv-m", options: { Size: "M" } },
      ] as never);
    etsyConnectionRequest.mockResolvedValue({
      ok: true,
      data: {
        products: [
          {
            product_id: 11,
            sku: "S",
            property_values: [{ property_id: 513, property_name: "Size", values: ["S"] }],
            offerings: [{ offering_id: 101, quantity: 4, is_enabled: true, price: 10 }],
          },
          {
            product_id: 12,
            sku: "M",
            property_values: [{ property_id: 513, property_name: "Size", values: ["M"] }],
            offerings: [{ offering_id: 102, quantity: 2, is_enabled: true, price: 12 }],
          },
        ],
      },
    });

    const result = await syncEtsyListingVariantTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      storeItemId: "item-1",
      etsyListingId: "999",
      taxonomyId: 1,
      readinessStateId: 1,
      inventoryTracking: "tracked",
      direction: "pull",
    });

    expect(result).toMatchObject({ status: "PULLED", pairCount: 2 });
    expect(applyFoundationSellerMatrixStructure).toHaveBeenCalled();
    expect(recordShopifyListingVariantTopologyDesire).toHaveBeenCalledWith(prisma, {
      memberId: "mem-1",
      storeItemId: "item-1",
    });
    expect(pushStoreItemTopologyToShopifyNow).toHaveBeenCalledWith({
      memberId: "mem-1",
      storeItemId: "item-1",
    });
  });

  it("does not retire a variant INW just added when Etsy still has the old matrix", async () => {
    const {
      prisma,
      recordEtsyListingVariantTopologyDesire,
      recordShopifyListingVariantTopologyDesire,
      applyFoundationSellerMatrixStructure,
    } = await import("database");
    vi.mocked(recordEtsyListingVariantTopologyDesire).mockClear();
    vi.mocked(recordShopifyListingVariantTopologyDesire).mockClear();
    vi.mocked(applyFoundationSellerMatrixStructure).mockClear();
    const cotton = {
      id: "sv-cotton",
      options: { Material: "Cotton", Size: "Small", "Primary color": "Red" },
      priceCents: 700,
      sku: null,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      inventoryState: { mode: "TRACKED_FINITE", onHand: 5, reserved: 0 },
    };
    const wool = {
      id: "sv-wool",
      options: { Material: "Wool", Size: "Small", "Primary color": "Red" },
      priceCents: 400,
      sku: null,
      createdAt: new Date(),
      inventoryState: { mode: "TRACKED_FINITE", onHand: 2, reserved: 0 },
    };
    vi.mocked(prisma.storeVariant.findMany)
      .mockResolvedValueOnce([cotton, wool] as never)
      .mockResolvedValueOnce([cotton, wool] as never);
    etsyConnectionRequest.mockResolvedValue({
      ok: true,
      data: {
        products: [
          {
            product_id: 11,
            sku: "COTTON",
            property_values: [
              { property_id: 513, property_name: "Material", values: ["Cotton"] },
              { property_id: 514, property_name: "Primary color", values: ["Red"] },
              { property_id: 516, property_name: "Size", values: ["Small"] },
            ],
            offerings: [{ offering_id: 101, quantity: 5, is_enabled: true, price: 7 }],
          },
        ],
      },
    });

    const result = await syncEtsyListingVariantTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      storeItemId: "item-1",
      etsyListingId: "999",
      taxonomyId: 1,
      readinessStateId: 1,
      inventoryTracking: "tracked",
      direction: "pull",
    });

    expect(result).toMatchObject({ status: "NOOP", reason: "STALE_REMOTE_STRUCTURE" });
    expect(applyFoundationSellerMatrixStructure).not.toHaveBeenCalled();
    expect(recordShopifyListingVariantTopologyDesire).not.toHaveBeenCalled();
    expect(recordEtsyListingVariantTopologyDesire).toHaveBeenCalledWith(prisma, {
      memberId: "mem-1",
      storeItemId: "item-1",
    });
  });

  it("adopts an Etsy Secondary color add instead of writing the old INW matrix back", async () => {
    const {
      prisma,
      recordEtsyListingVariantTopologyDesire,
      recordShopifyListingVariantTopologyDesire,
      applyFoundationSellerMatrixStructure,
    } = await import("database");
    const { pushStoreItemTopologyToShopifyNow } = await import("../shopify/reconcile-listing");
    vi.mocked(recordEtsyListingVariantTopologyDesire).mockClear();
    vi.mocked(recordShopifyListingVariantTopologyDesire).mockClear();
    vi.mocked(applyFoundationSellerMatrixStructure).mockClear();
    vi.mocked(pushStoreItemTopologyToShopifyNow).mockClear();
    const wool = {
      id: "sv-wool",
      options: { Material: "Wool", Size: "Small", "Primary color": "Red" },
      priceCents: 400,
      sku: null,
      createdAt: new Date(),
      inventoryState: { mode: "TRACKED_FINITE", onHand: 2, reserved: 0 },
    };
    vi.mocked(prisma.storeVariant.findMany)
      .mockResolvedValueOnce([wool] as never)
      .mockResolvedValueOnce([wool] as never)
      .mockResolvedValueOnce([
        {
          id: "sv-navy",
          options: {
            Material: "Wool",
            Size: "Small",
            "Primary color": "Red",
            "Secondary color": "Navy",
          },
        },
        {
          id: "sv-gold",
          options: {
            Material: "Wool",
            Size: "Small",
            "Primary color": "Red",
            "Secondary color": "Gold",
          },
        },
      ] as never);
    etsyConnectionRequest.mockResolvedValue({
      ok: true,
      data: {
        products: [
          {
            product_id: 21,
            sku: "NAVY",
            property_values: [
              { property_id: 507, property_name: "Material", values: ["Wool"] },
              { property_id: 200, property_name: "Primary color", values: ["Red"] },
              { property_id: 513, property_name: "Size", values: ["Small"] },
              { property_id: 514, property_name: "Secondary color", values: ["Navy"] },
            ],
            offerings: [{ offering_id: 201, quantity: 2, is_enabled: true, price: 4 }],
          },
          {
            product_id: 22,
            sku: "GOLD",
            property_values: [
              { property_id: 507, property_name: "Material", values: ["Wool"] },
              { property_id: 200, property_name: "Primary color", values: ["Red"] },
              { property_id: 513, property_name: "Size", values: ["Small"] },
              { property_id: 514, property_name: "Secondary color", values: ["Gold"] },
            ],
            offerings: [{ offering_id: 202, quantity: 2, is_enabled: true, price: 4 }],
          },
        ],
      },
    });

    const result = await syncEtsyListingVariantTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      storeItemId: "item-1",
      etsyListingId: "999",
      taxonomyId: 1,
      readinessStateId: 1,
      inventoryTracking: "tracked",
      direction: "pull",
    });

    expect(result).toMatchObject({ status: "PULLED", pairCount: 2 });
    expect(applyFoundationSellerMatrixStructure).toHaveBeenCalled();
    expect(recordEtsyListingVariantTopologyDesire).not.toHaveBeenCalled();
    expect(recordShopifyListingVariantTopologyDesire).toHaveBeenCalledWith(prisma, {
      memberId: "mem-1",
      storeItemId: "item-1",
    });
    expect(pushStoreItemTopologyToShopifyNow).toHaveBeenCalledWith({
      memberId: "mem-1",
      storeItemId: "item-1",
    });
  });
});
