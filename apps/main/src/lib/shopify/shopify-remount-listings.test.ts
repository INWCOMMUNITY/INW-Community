import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      shopifyListingLink: { findMany: vi.fn() },
      shopifySyncJob: { update: vi.fn(), updateMany: vi.fn() },
    },
    createShopifyListingMapping: vi.fn(),
    ensureShopifyPublishListingJob: vi.fn(),
  };
});

vi.mock("./listing-product-lookup", () => ({
  lookupShopifyListingProductByCustomIdValue: vi.fn(),
}));

vi.mock("./admin-graphql", () => ({
  executeShopifyAdminGraphql: vi.fn(),
}));

import {
  createShopifyListingMapping,
  ensureShopifyPublishListingJob,
  prisma,
} from "database";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { handleShopifyRemountListingsJob } from "./remount-listings";

const claim = {
  id: "job-remount-1",
  shopifyConnectionId: "conn-new",
  kind: "REMOUNT_LISTINGS" as const,
  dedupeKey: "REMOUNT_LISTINGS:conn-new",
  evidenceId: null,
  payload: {
    connectionId: "conn-new",
    memberId: "member-a",
    shopId: "gid://shopify/Shop/1",
  },
  payloadHash: null,
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "worker-1",
  leaseToken: "lease-1",
  leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

describe("REMOUNT_LISTINGS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue({
      id: "conn-new",
      memberId: "member-a",
      shopId: "gid://shopify/Shop/1",
      status: "ACTIVE",
      generation: 2,
    } as never);
    vi.mocked(prisma.shopifyConnection.findMany).mockResolvedValue([
      { id: "conn-old", generation: 1 },
    ] as never);
    vi.mocked(prisma.shopifyListingLink.findMany)
      .mockResolvedValueOnce([
        {
          shopifyConnectionId: "conn-old",
          storeItemId: "item-1",
          shopifyProductId: "gid://shopify/Product/9",
          importSource: "NATIVE",
          variantMaps: [
            {
              storeVariantId: "sv-1",
              shopifyVariantId: "gid://shopify/ProductVariant/1",
              shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
            },
          ],
        },
      ] as never)
      .mockResolvedValueOnce([{ storeItemId: "already" }] as never);
    vi.mocked(prisma.shopifySyncJob.update).mockResolvedValue({} as never);
    vi.mocked(createShopifyListingMapping).mockResolvedValue({
      listingLink: { id: "link-new" },
      variantMaps: [],
    } as never);
    vi.mocked(ensureShopifyPublishListingJob).mockResolvedValue({
      id: "pub-1",
      state: "PENDING",
    } as never);
  });

  it("remounts prior NATIVE mapping without productSet and enqueues publish", async () => {
    vi.mocked(executeShopifyAdminGraphql).mockImplementation(async (input) => {
      if (input.operationName === "ShopifyRemountProductLookup") {
        return {
          ok: true,
          class: "SUCCESS",
          httpStatus: 200,
          requestId: null,
          data: {
            product: {
              id: "gid://shopify/Product/9",
              status: "DRAFT",
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                  },
                ],
              },
            },
          },
          errors: null,
          cost: null,
          outcomeUnknown: false,
          message: "ok",
        } as never;
      }
      if (input.operationName === "ShopifyRemountExportCustomId") {
        return {
          ok: true,
          class: "SUCCESS",
          httpStatus: 200,
          requestId: null,
          data: { metafieldsSet: { userErrors: [] } },
          errors: null,
          cost: null,
          outcomeUnknown: false,
          message: "ok",
        } as never;
      }
      throw new Error(`unexpected ${input.operationName}`);
    });

    const result = await handleShopifyRemountListingsJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(createShopifyListingMapping).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectionId: "conn-new",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/9",
      })
    );
    expect(ensureShopifyPublishListingJob).toHaveBeenCalled();
    const ops = vi.mocked(executeShopifyAdminGraphql).mock.calls.map((c) => c[0].operationName);
    expect(ops).not.toContain("ShopifyCreateListingProductSet");
  });
});
