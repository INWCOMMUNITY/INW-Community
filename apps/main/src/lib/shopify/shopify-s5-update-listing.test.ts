import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findUnique: vi.fn() },
      shopifyListingLink: { findUnique: vi.fn() },
      shopifyVariantMap: { findMany: vi.fn() },
      storeItem: { findFirst: vi.fn() },
      storeVariant: { findFirst: vi.fn() },
    },
    markShopifyProductContentApplied: vi.fn(),
    markShopifyVariantContentApplied: vi.fn(),
    setShopifyProductContentConflict: vi.fn(),
    setShopifyVariantContentConflict: vi.fn(),
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
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  prisma,
  setShopifyProductContentConflict,
  setShopifyVariantContentConflict,
  shopifyMoneyFromCents,
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
} from "database";
import { handleShopifyUpdateListingContentJob } from "./update-listing-content";
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

const listing = {
  id: "link-1",
  shopifyConnectionId: "conn-gen-1",
  memberId: "member-a",
  storeItemId: "item-1",
  shopifyProductId: "gid://shopify/Product/9",
  desiredProductContentVersion: 2,
  appliedProductContentVersion: 0,
  desiredProductFingerprint: shopifyProductContentFingerprint({
    title: "New Title",
    description: "New Desc",
  }),
  // S4-seeded BASE = last verified remote content before seller edit.
  appliedProductFingerprint: shopifyProductContentFingerprint({
    title: "Old Title",
    description: "Old Desc",
  }),
  productContentAppliedAt: new Date("2026-09-24T12:00:00Z"),
  productDesiredAt: new Date("2026-09-25T10:00:00Z"),
  productContentConflict: false,
  productConflictRemoteFingerprint: null,
  productConflictEvidenceId: null,
  productConflictDetectedAt: null,
};

const variantMap = {
  id: "vmap-1",
  shopifyConnectionId: "conn-gen-1",
  shopifyListingLinkId: "link-1",
  memberId: "member-a",
  storeItemId: "item-1",
  storeVariantId: "var-1",
  shopifyVariantId: "gid://shopify/ProductVariant/8",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/7",
  desiredVariantContentVersion: 2,
  appliedVariantContentVersion: 0,
  desiredVariantFingerprint: shopifyVariantContentFingerprint({
    priceCents: 1037,
    sku: "SKU-NEW",
  }),
  appliedVariantFingerprint: shopifyVariantContentFingerprint({
    priceCents: 999,
    sku: "SKU-OLD",
  }),
  variantContentAppliedAt: new Date("2026-09-24T12:00:00Z"),
  variantDesiredAt: new Date("2026-09-25T10:00:00Z"),
  variantContentConflict: false,
  variantConflictRemoteFingerprint: null,
  variantConflictEvidenceId: null,
  variantConflictDetectedAt: null,
};

const storeItem = {
  id: "item-1",
  memberId: "member-a",
  title: "New Title",
  description: "New Desc",
  priceCents: 1037,
  sku: "SKU-NEW",
};

const storeVariant = {
  id: "var-1",
  memberId: "member-a",
  storeItemId: "item-1",
  priceCents: 1037,
  sku: "SKU-NEW",
};

const claim = {
  id: "job-1",
  shopifyConnectionId: "conn-gen-1",
  kind: "UPDATE_LISTING_CONTENT" as const,
  dedupeKey: "UPDATE_LISTING_CONTENT:conn-gen-1:item-1:p2:v2",
  evidenceId: null,
  payload: {
    storeItemId: "item-1",
    storeVariantId: "var-1",
    productDesiredVersion: 2,
    variantDesiredVersion: 2,
  },
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

function remoteProduct(input: {
  title?: string;
  descriptionHtml?: string | null;
  price?: string;
  sku?: string | null;
  status?: string;
  productId?: string;
  variantId?: string;
}) {
  return jsonResponse({
    data: {
      product: {
        id: input.productId ?? "gid://shopify/Product/9",
        status: input.status ?? "DRAFT",
        title: input.title ?? "Old Title",
        descriptionHtml: input.descriptionHtml ?? "Old Desc",
        variants: {
          nodes: [
            {
              id: input.variantId ?? "gid://shopify/ProductVariant/8",
              price: input.price ?? "9.99",
              sku: input.sku ?? "SKU-OLD",
            },
          ],
        },
      },
    },
  });
}

function productUpdateOk() {
  return jsonResponse({
    data: {
      productUpdate: {
        product: {
          id: "gid://shopify/Product/9",
          title: "New Title",
          descriptionHtml: "New Desc",
          status: "DRAFT",
        },
        userErrors: [],
      },
    },
  });
}

function variantUpdateOk() {
  return jsonResponse({
    data: {
      productVariantsBulkUpdate: {
        productVariants: [{ id: "gid://shopify/ProductVariant/8", price: "10.37", sku: "SKU-NEW" }],
        userErrors: [],
      },
    },
  });
}

function setupHappyMocks(overrides?: {
  listing?: Partial<typeof listing>;
  variantMap?: Partial<typeof variantMap>;
}) {
  vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
  vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue({
    ...listing,
    ...overrides?.listing,
  } as never);
  vi.mocked(prisma.shopifyVariantMap.findMany).mockResolvedValue([
    { ...variantMap, ...overrides?.variantMap },
  ] as never);
  vi.mocked(prisma.storeItem.findFirst).mockResolvedValue(storeItem as never);
  vi.mocked(prisma.storeVariant.findFirst).mockResolvedValue(storeVariant as never);
  vi.mocked(markShopifyProductContentApplied).mockResolvedValue(undefined);
  vi.mocked(markShopifyVariantContentApplied).mockResolvedValue(undefined);
  vi.mocked(setShopifyProductContentConflict).mockResolvedValue(undefined);
  vi.mocked(setShopifyVariantContentConflict).mockResolvedValue(undefined);
}

describe("shopify S5 fingerprints + money", () => {
  it("serializes $10.37 exactly", () => {
    expect(shopifyMoneyFromCents(1037)).toBe("10.37");
  });

  it("echo fingerprints match applied markers for same owned fields", () => {
    const productFp = shopifyProductContentFingerprint({
      title: "New Title",
      description: "New Desc",
    });
    const variantFp = shopifyVariantContentFingerprint({
      priceCents: 1037,
      sku: "SKU-NEW",
    });
    expect(productFp).toBe(listing.desiredProductFingerprint);
    expect(variantFp).toBe(variantMap.desiredVariantFingerprint);
    expect(
      shopifyProductContentFingerprint({ title: "Changed", description: "New Desc" })
    ).not.toBe(productFp);
  });
});

describe("shopify UPDATE_LISTING_CONTENT handler", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockReset();
    vi.mocked(prisma.shopifyListingLink.findUnique).mockReset();
    vi.mocked(prisma.shopifyVariantMap.findMany).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(prisma.storeVariant.findFirst).mockReset();
    vi.mocked(markShopifyProductContentApplied).mockReset();
    vi.mocked(markShopifyVariantContentApplied).mockReset();
    vi.mocked(setShopifyProductContentConflict).mockReset();
    vi.mocked(setShopifyVariantContentConflict).mockReset();
  });

  it("uses productUpdate + productVariantsBulkUpdate with exact GIDs and $10.37", async () => {
    setupHappyMocks();
    const ops: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toContain(`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`);
      const body = JSON.parse(String(init?.body)) as {
        operationName?: string;
        variables: Record<string, unknown>;
      };
      ops.push(body.operationName ?? "");
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({});
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        const product = body.variables.product as Record<string, unknown>;
        expect(product).toEqual({
          id: "gid://shopify/Product/9",
          title: "New Title",
          descriptionHtml: "New Desc",
        });
        expect(product).not.toHaveProperty("status");
        expect(JSON.stringify(body)).not.toMatch(/productSet/i);
        expect(JSON.stringify(body)).not.toMatch(/publish|inventorySet|inventoryAdjust/i);
        return productUpdateOk();
      }
      expect(body.operationName).toBe("ShopifyListingContentVariantUpdate");
      const variants = body.variables.variants as Array<Record<string, unknown>>;
      expect(body.variables.productId).toBe("gid://shopify/Product/9");
      expect(variants).toEqual([
        {
          id: "gid://shopify/ProductVariant/8",
          price: "10.37",
          inventoryItem: { sku: "SKU-NEW" },
        },
      ]);
      expect(JSON.stringify(variants[0])).not.toMatch(/inventoryQuantities|quantityAdjustments|optionValues|media/i);
      return variantUpdateOk();
    });

    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(ops).toEqual([
      "ShopifyListingContentRead",
      "ShopifyListingContentProductUpdate",
      "ShopifyListingContentVariantUpdate",
    ]);
    expect(markShopifyProductContentApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        listingLinkId: "link-1",
        desiredVersion: 2,
        fingerprint: listing.desiredProductFingerprint,
      })
    );
    expect(markShopifyVariantContentApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variantMapId: "vmap-1",
        desiredVersion: 2,
        fingerprint: variantMap.desiredVariantFingerprint,
      })
    );
  });

  it("skips mutations when remote already matches desired and advances applied", async () => {
    setupHappyMocks();
    let mutations = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({
          title: "New Title",
          descriptionHtml: "New Desc",
          price: "10.37",
          sku: "SKU-NEW",
        });
      }
      mutations += 1;
      throw new Error("must not mutate when converged");
    });

    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(mutations).toBe(0);
    expect(markShopifyProductContentApplied).toHaveBeenCalledTimes(1);
    expect(markShopifyVariantContentApplied).toHaveBeenCalledTimes(1);
  });

  it("suppresses stale v1 after v2 applied with zero provider mutation", async () => {
    setupHappyMocks({
      listing: {
        desiredProductContentVersion: 2,
        appliedProductContentVersion: 2,
        desiredProductFingerprint: listing.desiredProductFingerprint,
        appliedProductFingerprint: listing.desiredProductFingerprint,
      },
      variantMap: {
        desiredVariantContentVersion: 2,
        appliedVariantContentVersion: 2,
        desiredVariantFingerprint: variantMap.desiredVariantFingerprint,
        appliedVariantFingerprint: variantMap.desiredVariantFingerprint,
      },
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("stale job must not call Shopify");
    });

    const result = await handleShopifyUpdateListingContentJob(
      {
        ...claim,
        payload: {
          storeItemId: "item-1",
          storeVariantId: "var-1",
          productDesiredVersion: 1,
          variantDesiredVersion: 1,
        },
      },
      { fetchImpl }
    );
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(markShopifyProductContentApplied).not.toHaveBeenCalled();
  });

  it("recovers product NETWORK_UNKNOWN via read-before-write without remutation", async () => {
    setupHappyMocks({
      variantMap: {
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
      },
    });
    let productUpdateCalls = 0;
    let reads = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        reads += 1;
        if (reads === 1) {
          return remoteProduct({ title: "Old Title", descriptionHtml: "Old Desc" });
        }
        return remoteProduct({
          title: "New Title",
          descriptionHtml: "New Desc",
          price: "10.37",
          sku: "SKU-NEW",
        });
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        productUpdateCalls += 1;
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }
      throw new Error(`unexpected ${body.operationName}`);
    });

    const productOnlyClaim = {
      ...claim,
      payload: {
        storeItemId: "item-1",
        storeVariantId: "var-1",
        productDesiredVersion: 2,
        variantDesiredVersion: 0,
      },
    };

    const first = await handleShopifyUpdateListingContentJob(productOnlyClaim, { fetchImpl });
    expect(first).toMatchObject({ outcome: "RETRY", errorClass: "NETWORK_UNKNOWN" });
    expect(productUpdateCalls).toBe(1);
    expect(markShopifyProductContentApplied).not.toHaveBeenCalled();

    const second = await handleShopifyUpdateListingContentJob(
      { ...productOnlyClaim, attemptCount: 2 },
      { fetchImpl }
    );
    expect(second).toEqual({ outcome: "SUCCESS" });
    expect(productUpdateCalls).toBe(1);
    expect(markShopifyProductContentApplied).toHaveBeenCalledTimes(1);
  });

  it("recovers variant NETWORK_UNKNOWN via read-before-write without remutation", async () => {
    setupHappyMocks({
      listing: {
        desiredProductContentVersion: 0,
        appliedProductContentVersion: 0,
        desiredProductFingerprint: null,
      },
    });
    let variantUpdateCalls = 0;
    let reads = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        reads += 1;
        if (reads === 1) {
          return remoteProduct({
            title: "New Title",
            descriptionHtml: "New Desc",
            price: "9.99",
            sku: "SKU-OLD",
          });
        }
        return remoteProduct({
          title: "New Title",
          descriptionHtml: "New Desc",
          price: "10.37",
          sku: "SKU-NEW",
        });
      }
      if (body.operationName === "ShopifyListingContentVariantUpdate") {
        variantUpdateCalls += 1;
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }
      throw new Error(`unexpected ${body.operationName}`);
    });

    const variantOnlyClaim = {
      ...claim,
      payload: {
        storeItemId: "item-1",
        storeVariantId: "var-1",
        productDesiredVersion: 0,
        variantDesiredVersion: 2,
      },
    };

    const first = await handleShopifyUpdateListingContentJob(variantOnlyClaim, { fetchImpl });
    expect(first).toMatchObject({ outcome: "RETRY", errorClass: "NETWORK_UNKNOWN" });
    expect(variantUpdateCalls).toBe(1);

    const second = await handleShopifyUpdateListingContentJob(
      { ...variantOnlyClaim, attemptCount: 2 },
      { fetchImpl }
    );
    expect(second).toEqual({ outcome: "SUCCESS" });
    expect(variantUpdateCalls).toBe(1);
    expect(markShopifyVariantContentApplied).toHaveBeenCalledTimes(1);
  });

  it("persists product applied on partial success and skips product on retry", async () => {
    setupHappyMocks();
    let productUpdates = 0;
    let variantUpdates = 0;
    let attempt = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        attempt += 1;
        if (attempt === 1) {
          return remoteProduct({});
        }
        // Product already applied remotely; variant still stale.
        return remoteProduct({
          title: "New Title",
          descriptionHtml: "New Desc",
          price: "9.99",
          sku: "SKU-OLD",
        });
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        productUpdates += 1;
        return productUpdateOk();
      }
      if (body.operationName === "ShopifyListingContentVariantUpdate") {
        variantUpdates += 1;
        if (variantUpdates === 1) {
          throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
        }
        return variantUpdateOk();
      }
      throw new Error(`unexpected ${body.operationName}`);
    });

    const first = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(first).toMatchObject({ outcome: "RETRY" });
    expect(productUpdates).toBe(1);
    expect(variantUpdates).toBe(1);
    expect(markShopifyProductContentApplied).toHaveBeenCalledTimes(1);
    expect(markShopifyVariantContentApplied).not.toHaveBeenCalled();

    // Simulate DB product applied marker after first attempt.
    setupHappyMocks({
      listing: {
        appliedProductContentVersion: 2,
        appliedProductFingerprint: listing.desiredProductFingerprint,
      },
    });

    const second = await handleShopifyUpdateListingContentJob(
      { ...claim, attemptCount: 2 },
      { fetchImpl }
    );
    expect(second).toEqual({ outcome: "SUCCESS" });
    expect(productUpdates).toBe(1);
    expect(variantUpdates).toBe(2);
    expect(markShopifyVariantContentApplied).toHaveBeenCalledTimes(1);
  });

  it("recovers lost applied-marker write after provider success without remutation", async () => {
    setupHappyMocks({
      variantMap: {
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
      },
    });
    let productUpdates = 0;
    let reads = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        reads += 1;
        if (reads === 1) return remoteProduct({ title: "Old Title", descriptionHtml: "Old Desc" });
        return remoteProduct({
          title: "New Title",
          descriptionHtml: "New Desc",
          price: "10.37",
          sku: "SKU-NEW",
        });
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        productUpdates += 1;
        return productUpdateOk();
      }
      throw new Error(`unexpected ${body.operationName}`);
    });

    const productOnlyClaim = {
      ...claim,
      payload: {
        storeItemId: "item-1",
        storeVariantId: "var-1",
        productDesiredVersion: 2,
        variantDesiredVersion: 0,
      },
    };

    vi.mocked(markShopifyProductContentApplied)
      .mockRejectedValueOnce(new Error("db write lost"))
      .mockResolvedValue(undefined);

    await expect(
      handleShopifyUpdateListingContentJob(productOnlyClaim, { fetchImpl })
    ).rejects.toThrow("db write lost");
    expect(productUpdates).toBe(1);

    const second = await handleShopifyUpdateListingContentJob(
      { ...productOnlyClaim, attemptCount: 2 },
      { fetchImpl }
    );
    expect(second).toEqual({ outcome: "SUCCESS" });
    expect(productUpdates).toBe(1);
    expect(markShopifyProductContentApplied).toHaveBeenCalled();
  });

  it("fails closed for inactive connection without Shopify calls", async () => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue({
      ...connection,
      status: "INACTIVE",
    } as never);
    const fetchImpl = vi.fn();
    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorClass: "CONNECTION_INACTIVE",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when unmapped", async () => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue(null);
    const fetchImpl = vi.fn();
    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toMatchObject({ outcome: "DEAD", errorClass: "UNMAPPED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when remote product is ACTIVE", async () => {
    setupHappyMocks();
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({ status: "ACTIVE" });
      }
      throw new Error("must not mutate ACTIVE product in S5");
    });
    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorCode: "PRODUCT_NOT_DRAFT",
    });
  });

  it("fails closed when mapped remote variant is missing", async () => {
    setupHappyMocks();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          product: {
            id: "gid://shopify/Product/9",
            status: "DRAFT",
            title: "Old",
            descriptionHtml: "Old",
            variants: { nodes: [{ id: "gid://shopify/ProductVariant/999", price: "1.00", sku: "X" }] },
          },
        },
      })
    );
    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorClass: "REMOTE_MISSING",
      errorCode: "REMOTE_VARIANT_MISSING",
    });
  });

  it("detects CONFLICT before webhook and skips productUpdate", async () => {
    // BASE=A (Old), LOCAL=C (New), REMOTE=B (Shopify independent edit).
    setupHappyMocks({
      variantMap: {
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
      },
    });
    let productUpdates = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({
          title: "Shopify Independent",
          descriptionHtml: "Remote B",
        });
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        productUpdates += 1;
        return productUpdateOk();
      }
      throw new Error(`unexpected ${body.operationName}`);
    });
    const productOnlyClaim = {
      ...claim,
      payload: {
        storeItemId: "item-1",
        storeVariantId: "var-1",
        productDesiredVersion: 2,
        variantDesiredVersion: 0,
      },
    };
    const result = await handleShopifyUpdateListingContentJob(productOnlyClaim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(productUpdates).toBe(0);
    expect(setShopifyProductContentConflict).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        listingLinkId: "link-1",
        remoteFingerprint: shopifyProductContentFingerprint({
          title: "Shopify Independent",
          description: "Remote B",
        }),
      })
    );
    expect(markShopifyProductContentApplied).not.toHaveBeenCalled();
  });

  it("skips mutation when unresolved product conflict flag is set", async () => {
    setupHappyMocks({
      listing: { productContentConflict: true },
      variantMap: {
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
      },
    });
    let productUpdates = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({});
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        productUpdates += 1;
        return productUpdateOk();
      }
      throw new Error(`unexpected ${body.operationName}`);
    });
    const result = await handleShopifyUpdateListingContentJob(
      {
        ...claim,
        payload: {
          storeItemId: "item-1",
          storeVariantId: "var-1",
          productDesiredVersion: 2,
          variantDesiredVersion: 0,
        },
      },
      { fetchImpl }
    );
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(productUpdates).toBe(0);
    expect(setShopifyProductContentConflict).not.toHaveBeenCalled();
  });

  it("allows LOCAL_ONLY product push while variant remains conflicted", async () => {
    setupHappyMocks({
      variantMap: {
        ...variantMap,
        variantContentConflict: true,
        desiredVariantContentVersion: 2,
        appliedVariantContentVersion: 0,
      },
    });
    const ops: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      ops.push(body.operationName ?? "");
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({});
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        return productUpdateOk();
      }
      throw new Error("variant must not mutate while conflicted");
    });
    const result = await handleShopifyUpdateListingContentJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(ops).toEqual(["ShopifyListingContentRead", "ShopifyListingContentProductUpdate"]);
    expect(markShopifyProductContentApplied).toHaveBeenCalledTimes(1);
    expect(markShopifyVariantContentApplied).not.toHaveBeenCalled();
  });

  it("does not mutate on REMOTE_ONLY (leave to S6)", async () => {
    // LOCAL == BASE (Old), REMOTE = New Shopify-only edit; job versions still stale.
    const baseFp = shopifyProductContentFingerprint({
      title: "Old Title",
      description: "Old Desc",
    });
    setupHappyMocks({
      listing: {
        desiredProductContentVersion: 1,
        appliedProductContentVersion: 0,
        desiredProductFingerprint: baseFp,
        appliedProductFingerprint: baseFp,
        productDesiredAt: null,
      },
      variantMap: {
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
      },
    });
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      ...storeItem,
      title: "Old Title",
      description: "Old Desc",
    } as never);
    let productUpdates = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyListingContentRead") {
        return remoteProduct({
          title: "Shopify Only",
          descriptionHtml: "Remote",
        });
      }
      if (body.operationName === "ShopifyListingContentProductUpdate") {
        productUpdates += 1;
        return productUpdateOk();
      }
      throw new Error(`unexpected ${body.operationName}`);
    });
    const result = await handleShopifyUpdateListingContentJob(
      {
        ...claim,
        payload: {
          storeItemId: "item-1",
          storeVariantId: "var-1",
          productDesiredVersion: 1,
          variantDesiredVersion: 0,
        },
      },
      { fetchImpl }
    );
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(productUpdates).toBe(0);
    expect(markShopifyProductContentApplied).not.toHaveBeenCalled();
  });
});
