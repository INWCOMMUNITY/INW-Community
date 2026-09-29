import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      $transaction: vi.fn(),
      shopifyConnection: { findFirst: vi.fn() },
      shopifyListingLink: { findFirst: vi.fn() },
      storeItem: { create: vi.fn() },
      storeVariant: { findMany: vi.fn() },
    },
    beginShopifyListingImportAttempt: vi.fn(),
    completeShopifyListingImportAttempt: vi.fn(),
    failShopifyListingImportAttempt: vi.fn(),
    createShopifyImportedListingMapping: vi.fn(),
    provisionNativeFoundationListing: vi.fn(),
    reconcileShopifyImportBootstrapSales: vi.fn(),
    validateShopifyImportTopology: actual.validateShopifyImportTopology,
    correlateVariantsByOptionCombination: actual.correlateVariantsByOptionCombination,
    shopifyTopologyToInwMatrix: actual.shopifyTopologyToInwMatrix,
  };
});

vi.mock("./import-discovery", () => ({
  fetchShopifyImportProductDetail: vi.fn(),
}));

import {
  beginShopifyListingImportAttempt,
  completeShopifyListingImportAttempt,
  createShopifyImportedListingMapping,
  failShopifyListingImportAttempt,
  prisma,
  provisionNativeFoundationListing,
  reconcileShopifyImportBootstrapSales,
} from "database";
import { fetchShopifyImportProductDetail } from "./import-discovery";
import { importShopifyListing } from "./import-listing";

const candidate = {
  shopifyProductId: "gid://shopify/Product/300",
  title: "Simple mug",
  descriptionHtml: "<p>Nice</p>",
  status: "ACTIVE",
  supported: true,
  unsupportedReason: null,
  priceCents: 1500,
  sku: "MUG1",
  shopifyVariantId: "gid://shopify/ProductVariant/4",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/4",
  inventoryTracked: true,
  requiresShipping: true,
  primaryLocationAvailable: 10,
  recommendedStockMode: "PHYSICAL" as const,
  imageUrl: null,
  variants: [],
  axes: [],
  matrix: null,
};

const multiCandidate = {
  shopifyProductId: "gid://shopify/Product/500",
  title: "T-Shirt",
  descriptionHtml: "<p>A shirt</p>",
  status: "ACTIVE",
  supported: true,
  unsupportedReason: null,
  priceCents: 2000,
  sku: null,
  shopifyVariantId: "gid://shopify/ProductVariant/10",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/10",
  inventoryTracked: true,
  requiresShipping: true,
  primaryLocationAvailable: 5,
  recommendedStockMode: "PHYSICAL" as const,
  imageUrl: null,
  variants: [
    {
      shopifyVariantId: "gid://shopify/ProductVariant/10",
      shopifyInventoryItemId: "gid://shopify/InventoryItem/10",
      priceCents: 2000,
      sku: "SHIRT-S",
      inventoryTracked: true,
      requiresShipping: true,
      primaryLocationAvailable: 5,
      selectedOptions: [{ name: "Size", value: "S" }],
      mediaIds: [],
    },
    {
      shopifyVariantId: "gid://shopify/ProductVariant/11",
      shopifyInventoryItemId: "gid://shopify/InventoryItem/11",
      priceCents: 2500,
      sku: "SHIRT-M",
      inventoryTracked: true,
      requiresShipping: true,
      primaryLocationAvailable: 3,
      selectedOptions: [{ name: "Size", value: "M" }],
      mediaIds: [],
    },
  ],
  axes: [{ name: "Size", position: 1, values: ["S", "M"] }],
  matrix: {
    axes: [{ name: "Size", values: ["S", "M"] }],
    skus: [
      { options: { Size: "S" }, quantity: 5, priceCents: 2000, sku: "SHIRT-S" },
      { options: { Size: "M" }, quantity: 3, priceCents: 2500, sku: "SHIRT-M" },
    ],
    pricesVary: true,
    quantitiesVary: true,
    skusVary: true,
  },
};

describe("importShopifyListing launch invariants", () => {
  beforeEach(() => {
    vi.mocked(fetchShopifyImportProductDetail).mockReset();
    vi.mocked(beginShopifyListingImportAttempt).mockReset();
    vi.mocked(completeShopifyListingImportAttempt).mockReset();
    vi.mocked(failShopifyListingImportAttempt).mockReset();
    vi.mocked(createShopifyImportedListingMapping).mockReset();
    vi.mocked(provisionNativeFoundationListing).mockReset();
    vi.mocked(reconcileShopifyImportBootstrapSales).mockReset();
    vi.mocked(prisma.$transaction).mockReset();
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
    } as never);
  });

  it("commits durable attempt before provider snapshot network read", async () => {
    const order: string[] = [];
    vi.mocked(beginShopifyListingImportAttempt).mockImplementation(async () => {
      order.push("begin");
      return {
        status: "READY",
        reusedCompleted: false,
        attempt: {
          id: "attempt-1",
          bootstrapStartedAt: new Date("2026-09-28T12:00:00.000Z"),
        } as never,
      };
    });
    vi.mocked(fetchShopifyImportProductDetail).mockImplementation(async () => {
      order.push("snapshot");
      return {
        status: "OK",
        connectionId: "conn-1",
        primaryLocationId: "gid://shopify/Location/1",
        candidate,
      };
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      order.push("canonical");
      const tx = {
        shopifyListingLink: { findFirst: vi.fn().mockResolvedValue(null) },
        storeItem: { create: vi.fn().mockResolvedValue({ id: "item-1" }) },
      };
      vi.mocked(provisionNativeFoundationListing).mockResolvedValue({
        variantIds: ["var-1"],
        kind: "simple",
      });
      vi.mocked(createShopifyImportedListingMapping).mockResolvedValue({
        listingLink: { id: "link-1" },
        variantMaps: [],
      } as never);
      vi.mocked(completeShopifyListingImportAttempt).mockResolvedValue({} as never);
      return fn(tx);
    });
    vi.mocked(reconcileShopifyImportBootstrapSales).mockResolvedValue({
      preBootstrapAcked: 0,
      postBootstrapApplied: 0,
      postBootstrapAlreadyApplied: 0,
      postBootstrapFailed: 0,
      postBootstrapUnmapped: 0,
    });

    await importShopifyListing({
      memberId: "member-a",
      shopifyProductId: candidate.shopifyProductId,
      stockMode: "PHYSICAL",
    });

    expect(order).toEqual(["begin", "snapshot", "canonical"]);
    expect(fetchShopifyImportProductDetail).toHaveBeenCalledTimes(1);
  });

  it("re-runs sale reconcile on ALREADY_COMPLETED retry (crash after commit)", async () => {
    const cutoff = new Date("2026-09-28T12:00:00.000Z");
    vi.mocked(beginShopifyListingImportAttempt).mockResolvedValue({
      status: "ALREADY_COMPLETED",
      reusedCompleted: true,
      attempt: {
        id: "attempt-1",
        storeItemId: "item-existing",
        listingLinkId: "link-existing",
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        bootstrapStartedAt: cutoff,
      } as never,
    });
    vi.mocked(reconcileShopifyImportBootstrapSales).mockResolvedValue({
      preBootstrapAcked: 0,
      postBootstrapApplied: 1,
      postBootstrapAlreadyApplied: 0,
      postBootstrapFailed: 0,
      postBootstrapUnmapped: 0,
    });

    const result = await importShopifyListing({
      memberId: "member-a",
      shopifyProductId: candidate.shopifyProductId,
      stockMode: "PHYSICAL",
    });

    expect(result).toMatchObject({
      status: "ALREADY_IMPORTED",
      storeItemId: "item-existing",
      bootstrap: { postBootstrapApplied: 1 },
    });
    expect(reconcileShopifyImportBootstrapSales).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        shopifyVariantId: "gid://shopify/ProductVariant/4",
        bootstrapStartedAt: cutoff,
      })
    );
    expect(fetchShopifyImportProductDetail).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not mark attempt FAILED when canonical write already completed and reconcile runs", async () => {
    vi.mocked(beginShopifyListingImportAttempt).mockResolvedValue({
      status: "READY",
      reusedCompleted: false,
      attempt: {
        id: "attempt-1",
        bootstrapStartedAt: new Date("2026-09-28T12:00:00.000Z"),
      } as never,
    });
    vi.mocked(fetchShopifyImportProductDetail).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
      candidate,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        shopifyListingLink: { findFirst: vi.fn().mockResolvedValue(null) },
        storeItem: { create: vi.fn().mockResolvedValue({ id: "item-1" }) },
      };
      vi.mocked(provisionNativeFoundationListing).mockResolvedValue({
        variantIds: ["var-1"],
        kind: "simple",
      });
      vi.mocked(createShopifyImportedListingMapping).mockResolvedValue({
        listingLink: { id: "link-1" },
        variantMaps: [],
      } as never);
      vi.mocked(completeShopifyListingImportAttempt).mockResolvedValue({} as never);
      return fn(tx);
    });
    vi.mocked(reconcileShopifyImportBootstrapSales).mockResolvedValue({
      preBootstrapAcked: 0,
      postBootstrapApplied: 0,
      postBootstrapAlreadyApplied: 0,
      postBootstrapFailed: 0,
      postBootstrapUnmapped: 0,
    });

    const result = await importShopifyListing({
      memberId: "member-a",
      shopifyProductId: candidate.shopifyProductId,
      stockMode: "PHYSICAL",
    });
    expect(result.status).toBe("IMPORTED");
    expect(failShopifyListingImportAttempt).not.toHaveBeenCalled();
  });

  it("rejects unsupported products from fresh provider re-read", async () => {
    vi.mocked(beginShopifyListingImportAttempt).mockResolvedValue({
      status: "READY",
      reusedCompleted: false,
      attempt: {
        id: "attempt-1",
        bootstrapStartedAt: new Date("2026-09-28T12:00:00.000Z"),
      } as never,
    });
    vi.mocked(fetchShopifyImportProductDetail).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
      candidate: {
        ...candidate,
        supported: false,
        unsupportedReason: "Product has 4 option dimensions; INW supports 1–3.",
      },
    });
    const result = await importShopifyListing({
      memberId: "member-a",
      shopifyProductId: candidate.shopifyProductId,
      stockMode: "PHYSICAL",
    });
    expect(result).toMatchObject({ status: "ERROR", code: "UNSUPPORTED_PRODUCT" });
    expect(failShopifyListingImportAttempt).toHaveBeenCalled();
  });

  it("imports multi-variant product with per-variant bootstrap reconcile", async () => {
    vi.mocked(beginShopifyListingImportAttempt).mockResolvedValue({
      status: "READY",
      reusedCompleted: false,
      attempt: {
        id: "attempt-1",
        bootstrapStartedAt: new Date("2026-09-28T12:00:00.000Z"),
      } as never,
    });
    vi.mocked(fetchShopifyImportProductDetail).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
      candidate: multiCandidate,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        shopifyListingLink: { findFirst: vi.fn().mockResolvedValue(null) },
        storeItem: { create: vi.fn().mockResolvedValue({ id: "item-multi" }) },
        storeVariant: {
          findMany: vi.fn().mockResolvedValue([
            { id: "sv-1", options: JSON.stringify({ Size: "S" }) },
            { id: "sv-2", options: JSON.stringify({ Size: "M" }) },
          ]),
        },
      };
      vi.mocked(provisionNativeFoundationListing).mockResolvedValue({
        variantIds: ["sv-1", "sv-2"],
        kind: "matrix",
      });
      vi.mocked(createShopifyImportedListingMapping).mockResolvedValue({
        listingLink: { id: "link-multi" },
        variantMaps: [],
      } as never);
      vi.mocked(completeShopifyListingImportAttempt).mockResolvedValue({} as never);
      return fn(tx);
    });
    vi.mocked(reconcileShopifyImportBootstrapSales).mockResolvedValue({
      preBootstrapAcked: 0,
      postBootstrapApplied: 0,
      postBootstrapAlreadyApplied: 0,
      postBootstrapFailed: 0,
      postBootstrapUnmapped: 0,
    });

    const result = await importShopifyListing({
      memberId: "member-a",
      shopifyProductId: multiCandidate.shopifyProductId,
      stockMode: "PHYSICAL",
    });

    expect(result.status).toBe("IMPORTED");
    if (result.status !== "IMPORTED") return;
    expect(result.storeItemId).toBe("item-multi");
    expect(result.listingLinkId).toBe("link-multi");
    // Should reconcile per variant
    expect(reconcileShopifyImportBootstrapSales).toHaveBeenCalledTimes(2);
  });
});
