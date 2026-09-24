import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findUnique: vi.fn(), findFirst: vi.fn() },
      storeItem: { findFirst: vi.fn() },
      storeVariant: { findMany: vi.fn() },
      shopifyProviderEvidence: { findUnique: vi.fn() },
    },
    lookupShopifyListingByStoreItem: vi.fn(),
    createShopifyListingMapping: vi.fn(),
    enqueueShopifySyncJob: vi.fn(),
  };
});

vi.mock("./connect", () => ({
  accessTokenForConnection: vi.fn(async () => ACCESS),
  ShopifyConnectError: class ShopifyConnectError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

import {
  createShopifyListingMapping,
  enqueueShopifySyncJob,
  lookupShopifyListingByStoreItem,
  prisma,
} from "database";
import {
  enqueueShopifyCreateListing,
  handleShopifyCreateListingJob,
} from "./create-listing";
import {
  SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
  SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
  shopifyCreateListingDedupeKey,
  shopifyListingExportCustomId,
} from "./listing-export-id";
import { SHOPIFY_ADMIN_API_VERSION } from "./constants";

const connection = {
  id: "conn-gen-1",
  memberId: "member-a",
  shopDomain: "my-shop.myshopify.com",
  status: "ACTIVE",
  primaryLocationId: "gid://shopify/Location/1",
  accessTokenEncrypted: "enc-a",
  refreshTokenEncrypted: "enc-r",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
  grantedScopes: "write_products",
  shopId: "gid://shopify/Shop/1",
  generation: 1,
  connectedAt: new Date("2026-09-24T12:00:00Z"),
  disconnectedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const claim = {
  id: "job-1",
  shopifyConnectionId: "conn-gen-1",
  kind: "CREATE_LISTING" as const,
  dedupeKey: "CREATE_LISTING:conn-gen-1:item-1",
  evidenceId: null,
  payload: { storeItemId: "item-1", storeVariantId: "var-1" },
  payloadHash: "hash",
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "w1",
  leaseToken: "tok",
  leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": "req-1" },
  });
}

describe("shopify CREATE_LISTING enqueue gates", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(prisma.storeVariant.findMany).mockReset();
    vi.mocked(lookupShopifyListingByStoreItem).mockReset();
    vi.mocked(enqueueShopifySyncJob).mockReset();
  });

  it("queues a CREATE_LISTING job for the seller's simple item", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(connection as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      memberId: "member-a",
      status: "active",
    } as never);
    vi.mocked(prisma.storeVariant.findMany).mockResolvedValue([{ id: "var-1" }] as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({ status: "UNMAPPED" });
    vi.mocked(enqueueShopifySyncJob).mockResolvedValue({
      id: "job-1",
      shopifyConnectionId: "conn-gen-1",
      kind: "CREATE_LISTING",
      dedupeKey: shopifyCreateListingDedupeKey("conn-gen-1", "item-1"),
      payload: { storeItemId: "item-1", storeVariantId: "var-1" },
    } as never);

    const result = await enqueueShopifyCreateListing({
      memberId: "member-a",
      storeItemId: "item-1",
    });
    expect(result).toEqual({
      status: "QUEUED",
      connectionId: "conn-gen-1",
      storeItemId: "item-1",
      jobId: "job-1",
    });
    expect(enqueueShopifySyncJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopifyConnectionId: "conn-gen-1",
        kind: "CREATE_LISTING",
        dedupeKey: "CREATE_LISTING:conn-gen-1:item-1",
        payload: { storeItemId: "item-1", storeVariantId: "var-1" },
      })
    );
    expect(JSON.stringify(vi.mocked(enqueueShopifySyncJob).mock.calls[0][1].payload)).not.toMatch(
      /shpat_|token|secret/i
    );
  });

  it("rejects another seller's store item", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(connection as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue(null);
    const result = await enqueueShopifyCreateListing({
      memberId: "member-a",
      storeItemId: "foreign-item",
    });
    expect(result).toMatchObject({ status: "ERROR", code: "NOT_FOUND" });
    expect(enqueueShopifySyncJob).not.toHaveBeenCalled();
  });

  it("rejects when there is no active Shopify connection", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(null);
    const result = await enqueueShopifyCreateListing({
      memberId: "member-a",
      storeItemId: "item-1",
    });
    expect(result).toMatchObject({ status: "ERROR", code: "CONNECTION_INACTIVE" });
  });

  it("rejects when primary location is missing", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      ...connection,
      primaryLocationId: null,
    } as never);
    const result = await enqueueShopifyCreateListing({
      memberId: "member-a",
      storeItemId: "item-1",
    });
    expect(result).toMatchObject({ status: "ERROR", code: "LOCATION_REQUIRED" });
    expect(enqueueShopifySyncJob).not.toHaveBeenCalled();
  });

  it("rejects zero or multiple variants before provider work", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(connection as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      memberId: "member-a",
      status: "active",
    } as never);
    vi.mocked(prisma.storeVariant.findMany).mockResolvedValue([
      { id: "var-1" },
      { id: "var-2" },
    ] as never);
    const result = await enqueueShopifyCreateListing({
      memberId: "member-a",
      storeItemId: "item-1",
    });
    expect(result).toMatchObject({ status: "ERROR", code: "UNSUPPORTED_VARIANTS" });
    expect(enqueueShopifySyncJob).not.toHaveBeenCalled();
  });

  it("returns already mapped for the current generation without enqueue", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(connection as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      memberId: "member-a",
      status: "active",
    } as never);
    vi.mocked(prisma.storeVariant.findMany).mockResolvedValue([{ id: "var-1" }] as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({
      status: "MAPPED",
      listingLink: {
        id: "link",
        shopifyConnectionId: "conn-gen-1",
        memberId: "member-a",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/9",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      variantMaps: [],
    });
    const result = await enqueueShopifyCreateListing({
      memberId: "member-a",
      storeItemId: "item-1",
    });
    expect(result).toEqual({
      status: "ALREADY_MAPPED",
      connectionId: "conn-gen-1",
      storeItemId: "item-1",
      shopifyProductId: "gid://shopify/Product/9",
    });
    expect(enqueueShopifySyncJob).not.toHaveBeenCalled();
  });

  it("scopes customId to connection generation, not StoreItem alone", () => {
    const a = shopifyListingExportCustomId("conn-gen-1", "item-1");
    const b = shopifyListingExportCustomId("conn-gen-2", "item-1");
    expect(a).not.toBe(b);
    expect(a).not.toBe("item-1");
  });
});

describe("shopify CREATE_LISTING provider", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(prisma.storeVariant.findMany).mockReset();
    vi.mocked(lookupShopifyListingByStoreItem).mockReset();
    vi.mocked(createShopifyListingMapping).mockReset();
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({ status: "UNMAPPED" });
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      memberId: "member-a",
      title: "Blue Mug",
      description: "<p>Nice</p>",
      status: "active",
    } as never);
    vi.mocked(prisma.storeVariant.findMany).mockResolvedValue([
      { id: "var-1", priceCents: 1250, sku: "SKU-1", memberId: "member-a", storeItemId: "item-1" },
    ] as never);
    vi.mocked(createShopifyListingMapping).mockResolvedValue({
      listingLink: {
        id: "link-1",
        shopifyConnectionId: "conn-gen-1",
        memberId: "member-a",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/9",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      variantMaps: [],
    } as never);
  });

  function metafieldLookupResponse() {
    return jsonResponse({
      data: {
        metafieldDefinitions: {
          nodes: [
            {
              id: "gid://shopify/MetafieldDefinition/1",
              namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
              key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
              type: { name: "id" },
            },
          ],
        },
      },
    });
  }

  function discoveryNull(customId: string) {
    return jsonResponse({
      data: { productByIdentifier: null },
      extensions: { customId },
    });
  }

  function discoveryProduct(input: {
    customId: string;
    status?: string;
    variants?: Array<{ id: string; inventoryItemId: string | null }>;
    metafieldValue?: string | null;
    variantsCount?: number;
  }) {
    const variants = input.variants ?? [
      { id: "gid://shopify/ProductVariant/8", inventoryItemId: "gid://shopify/InventoryItem/7" },
    ];
    return jsonResponse({
      data: {
        productByIdentifier: {
          id: "gid://shopify/Product/9",
          status: input.status ?? "DRAFT",
          listingExportId:
            input.metafieldValue === null
              ? null
              : { value: input.metafieldValue ?? input.customId },
          variantsCount: { count: input.variantsCount ?? variants.length },
          variants: {
            nodes: variants.map((v) => ({
              id: v.id,
              inventoryItem: v.inventoryItemId ? { id: v.inventoryItemId } : null,
            })),
            pageInfo: { hasNextPage: false },
          },
        },
      },
    });
  }

  function productSetSuccess() {
    return jsonResponse({
      data: {
        productSet: {
          product: {
            id: "gid://shopify/Product/9",
            status: "DRAFT",
            variants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/8",
                  inventoryItem: { id: "gid://shopify/InventoryItem/7" },
                },
              ],
            },
          },
          userErrors: [],
        },
      },
    });
  }

  it("discovers null then productSet DRAFT with generation-scoped customId", async () => {
    const customId = shopifyListingExportCustomId("conn-gen-1", "item-1");
    let discoveryCalls = 0;
    let productSetCalls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain(`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`);
      const body = JSON.parse(String(init?.body)) as {
        operationName?: string;
        query: string;
        variables: Record<string, unknown>;
      };
      if (body.operationName === "ShopifyListingExportMetafieldLookup") {
        return metafieldLookupResponse();
      }
      if (body.operationName === "ShopifyCreateListingProductByCustomId") {
        discoveryCalls += 1;
        expect(body.query.trimStart().startsWith("query")).toBe(true);
        const identifier = body.variables.identifier as {
          customId: { value: string; namespace: string; key: string };
        };
        expect(identifier.customId.value).toBe(customId);
        expect(identifier.customId.namespace).toBe(SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE);
        expect(identifier.customId.key).toBe(SHOPIFY_LISTING_EXPORT_METAFIELD_KEY);
        return discoveryNull(customId);
      }
      expect(body.operationName).toBe("ShopifyCreateListingProductSet");
      productSetCalls += 1;
      expect(body.query).toContain("mutation");
      expect(body.query).toContain("productSet");
      expect(body.query.toLowerCase()).not.toContain("inventorysetquantities");
      expect(body.query.toLowerCase()).not.toContain("publishablepublish");
      const variables = body.variables as {
        input: { status: string };
        identifier: { customId: { value: string } };
      };
      expect(variables.input.status).toBe("DRAFT");
      expect(variables.identifier.customId.value).toBe(customId);
      return productSetSuccess();
    });

    const result = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(discoveryCalls).toBe(1);
    expect(productSetCalls).toBe(1);
    expect(createShopifyListingMapping).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectionId: "conn-gen-1",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/9",
        variants: [
          {
            storeVariantId: "var-1",
            shopifyVariantId: "gid://shopify/ProductVariant/8",
            shopifyInventoryItemId: "gid://shopify/InventoryItem/7",
          },
        ],
      })
    );
  });

  it("on NETWORK_UNKNOWN retry discovers Product P and issues zero second productSet", async () => {
    const customId = shopifyListingExportCustomId("conn-gen-1", "item-1");
    let productSetCalls = 0;
    let discoveryCalls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        operationName?: string;
        variables: { identifier?: { customId?: { value?: string } } };
      };
      if (body.operationName === "ShopifyListingExportMetafieldLookup") {
        return metafieldLookupResponse();
      }
      if (body.operationName === "ShopifyCreateListingProductByCustomId") {
        discoveryCalls += 1;
        expect(body.variables.identifier?.customId?.value).toBe(customId);
        // Attempt 1: absent. Attempt 2: product exists after lost productSet success.
        if (discoveryCalls === 1) return discoveryNull(customId);
        return discoveryProduct({ customId });
      }
      expect(body.operationName).toBe("ShopifyCreateListingProductSet");
      productSetCalls += 1;
      expect(body.variables.identifier?.customId?.value).toBe(customId);
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });

    const first = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(first).toMatchObject({ outcome: "RETRY", errorCode: "PRODUCT_SET_UNKNOWN" });
    expect(createShopifyListingMapping).not.toHaveBeenCalled();
    expect(productSetCalls).toBe(1);

    const second = await handleShopifyCreateListingJob(
      { ...claim, attemptCount: 2 },
      { fetchImpl }
    );
    expect(second).toEqual({ outcome: "SUCCESS" });
    expect(productSetCalls).toBe(1);
    expect(discoveryCalls).toBe(2);
    expect(createShopifyListingMapping).toHaveBeenCalledTimes(1);
    expect(createShopifyListingMapping).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopifyProductId: "gid://shopify/Product/9",
        variants: [
          {
            storeVariantId: "var-1",
            shopifyVariantId: "gid://shopify/ProductVariant/8",
            shopifyInventoryItemId: "gid://shopify/InventoryItem/7",
          },
        ],
      })
    );
  });

  it("crash after provider success recovers via discovery without remutation", async () => {
    const customId = shopifyListingExportCustomId("conn-gen-1", "item-1");
    let productSetCalls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingExportMetafieldLookup") {
        return metafieldLookupResponse();
      }
      if (body.operationName === "ShopifyCreateListingProductByCustomId") {
        // Simulates lease reclaim after productSet succeeded but mapping never wrote.
        return discoveryProduct({ customId });
      }
      productSetCalls += 1;
      throw new Error("productSet must not run when product already exists");
    });

    const result = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(productSetCalls).toBe(0);
    expect(createShopifyListingMapping).toHaveBeenCalledTimes(1);
  });

  it("fails closed on merchant-modified multi-variant recovery without productSet", async () => {
    const customId = shopifyListingExportCustomId("conn-gen-1", "item-1");
    let productSetCalls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingExportMetafieldLookup") {
        return metafieldLookupResponse();
      }
      if (body.operationName === "ShopifyCreateListingProductByCustomId") {
        return discoveryProduct({
          customId,
          variants: [
            { id: "gid://shopify/ProductVariant/8", inventoryItemId: "gid://shopify/InventoryItem/7" },
            { id: "gid://shopify/ProductVariant/9", inventoryItemId: "gid://shopify/InventoryItem/8" },
          ],
          variantsCount: 2,
        });
      }
      productSetCalls += 1;
      return productSetSuccess();
    });

    const result = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "RECOVERY_VARIANT_CARDINALITY",
    });
    expect(productSetCalls).toBe(0);
    expect(createShopifyListingMapping).not.toHaveBeenCalled();
  });

  it("fails closed when recovered product is ACTIVE", async () => {
    const customId = shopifyListingExportCustomId("conn-gen-1", "item-1");
    let productSetCalls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingExportMetafieldLookup") {
        return metafieldLookupResponse();
      }
      if (body.operationName === "ShopifyCreateListingProductByCustomId") {
        return discoveryProduct({ customId, status: "ACTIVE" });
      }
      productSetCalls += 1;
      return productSetSuccess();
    });

    const result = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorClass: "RECOVERY_CONFLICT",
      errorCode: "RECOVERY_NOT_DRAFT",
    });
    expect(productSetCalls).toBe(0);
    expect(createShopifyListingMapping).not.toHaveBeenCalled();
  });

  it("retries when discovery query fails and does not call productSet", async () => {
    let productSetCalls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingExportMetafieldLookup") {
        return metafieldLookupResponse();
      }
      if (body.operationName === "ShopifyCreateListingProductByCustomId") {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }
      productSetCalls += 1;
      return productSetSuccess();
    });

    const result = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(result).toMatchObject({ outcome: "RETRY", errorCode: "PRODUCT_LOOKUP" });
    expect(productSetCalls).toBe(0);
    expect(createShopifyListingMapping).not.toHaveBeenCalled();
  });

  it("skips provider discovery and mutation when current-generation mapping already exists", async () => {
    vi.mocked(lookupShopifyListingByStoreItem).mockResolvedValue({
      status: "MAPPED",
      listingLink: {
        id: "link",
        shopifyConnectionId: "conn-gen-1",
        memberId: "member-a",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/9",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      variantMaps: [],
    });
    const fetchImpl = vi.fn();
    const result = await handleShopifyCreateListingJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(createShopifyListingMapping).not.toHaveBeenCalled();
  });
});
