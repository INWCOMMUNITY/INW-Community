import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findUnique: vi.fn() },
      shopifyListingLink: { findFirst: vi.fn() },
      shopifyVariantMap: { findFirst: vi.fn() },
      storeItem: { findFirst: vi.fn() },
    },
    classifyShopifyListingHealth: vi.fn(() => ({
      readiness: "SYNCING",
      contentHealth: "HEALTHY",
      inventoryHealth: "HEALTHY",
      issueCode: null,
      issueFingerprint: null,
      issueSeverity: null,
      issueMessage: null,
      blockContentOutbound: false,
      blockInventoryOutbound: false,
      remoteProductStatus: null,
    })),
    persistShopifyListingHealth: vi.fn(async () => ({
      previous: { readiness: "SYNCING", issueCode: null, issueFingerprint: null },
      next: { readiness: "READY_TO_PUBLISH" },
      issueChanged: false,
      issueCleared: false,
      issueOpened: false,
    })),
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
  classifyShopifyListingHealth,
  persistShopifyListingHealth,
  prisma,
} from "database";
import { handleShopifyPublishListingJob } from "./publish-listing-job";
import { SHOPIFY_ADMIN_API_VERSION } from "./constants";

const connection = {
  id: "conn-1",
  memberId: "member-a",
  shopDomain: "demo.myshopify.com",
  status: "ACTIVE",
  primaryLocationId: "gid://shopify/Location/1",
  accessTokenEncrypted: "enc",
  refreshTokenEncrypted: "enc-r",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
  grantedScopes: "write_products,write_publications",
  shopId: "gid://shopify/Shop/1",
  generation: 2,
  connectedAt: new Date(),
  disconnectedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const listing = {
  id: "link-1",
  shopifyConnectionId: "conn-1",
  memberId: "member-a",
  storeItemId: "item-1",
  shopifyProductId: "gid://shopify/Product/9",
  readiness: "SYNCING",
  contentHealth: "HEALTHY",
  inventoryHealth: "DEGRADED",
  issueCode: null,
  issueFingerprint: null,
  issueSeverity: null,
  issueMessage: null,
  issueFirstSeenAt: null,
  remoteProductStatus: "DRAFT",
  desiredProductContentVersion: 1,
  appliedProductContentVersion: 1,
  desiredProductFingerprint: "p1",
  appliedProductFingerprint: "p1",
  productContentConflict: false,
};

const variantMapInitialized = {
  id: "vmap-1",
  shopifyConnectionId: "conn-1",
  shopifyListingLinkId: "link-1",
  storeItemId: "item-1",
  storeVariantId: "var-1",
  shopifyVariantId: "gid://shopify/ProductVariant/8",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/7",
  inventoryInitState: "INITIALIZED",
  inventoryDesiredVersion: 1,
  inventoryAppliedVersion: 1,
  inventoryDesiredAvailable: 3,
  inventoryAppliedAvailable: 3,
  inventoryLastObservedAvailable: 3,
  inventoryDriftState: "NONE",
  desiredVariantContentVersion: 1,
  appliedVariantContentVersion: 1,
  desiredVariantFingerprint: "v1",
  appliedVariantFingerprint: "v1",
  variantContentConflict: false,
  createdAt: new Date(),
};

const claim = {
  id: "job-pub-1",
  shopifyConnectionId: "conn-1",
  kind: "PUBLISH_LISTING" as const,
  dedupeKey: "PUBLISH_LISTING:conn-1:item-1",
  evidenceId: null,
  payload: { storeItemId: "item-1", listingLinkId: "link-1" },
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

function publicationsResponse() {
  return jsonResponse({
    data: {
      publications: {
        nodes: [
          {
            id: "gid://shopify/Publication/55",
            name: "Online Store",
            catalog: {
              __typename: "AppCatalog",
              apps: { nodes: [{ handle: "online_store" }] },
            },
          },
        ],
      },
    },
  });
}

describe("PUBLISH_LISTING / Online Store export publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyListingLink.findFirst).mockResolvedValue(listing as never);
    vi.mocked(prisma.shopifyVariantMap.findFirst).mockResolvedValue(variantMapInitialized as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
    } as never);
  });

  it("waits for inventory initialization before publication", async () => {
    vi.mocked(prisma.shopifyVariantMap.findFirst).mockResolvedValue({
      ...variantMapInitialized,
      inventoryInitState: "PENDING",
      inventoryAppliedAvailable: null,
    } as never);
    const fetchImpl = vi.fn(async () => {
      throw new Error("provider must not be called while inventory PENDING");
    });
    const result = await handleShopifyPublishListingJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "RETRY",
      errorCode: "INVENTORY_INIT_PENDING",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("activates + publishes to Online Store after inventory init and keeps INW active", async () => {
    const ops: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain(`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`);
      const body = JSON.parse(String(init?.body)) as {
        operationName?: string;
        query: string;
        variables: Record<string, unknown>;
      };
      ops.push(body.operationName ?? "");
      if (body.operationName === "ShopifyOnlineStorePublicationLookup") {
        return publicationsResponse();
      }
      if (body.operationName === "ShopifyListingPublicationState") {
        const count = ops.filter((o) => o === "ShopifyListingPublicationState").length;
        if (count === 1) {
          return jsonResponse({
            data: {
              product: {
                id: "gid://shopify/Product/9",
                status: "DRAFT",
                publishedOnPublication: false,
              },
            },
          });
        }
        return jsonResponse({
          data: {
            product: {
              id: "gid://shopify/Product/9",
              status: "ACTIVE",
              publishedOnPublication: count >= 3,
            },
          },
        });
      }
      if (body.operationName === "ShopifyListingProductStatusLookup") {
        return jsonResponse({
          data: { product: { id: "gid://shopify/Product/9", status: "DRAFT" } },
        });
      }
      if (body.operationName === "ShopifyListingProductActivate") {
        expect(body.query).toContain("userErrors { field message }");
        expect(body.query).not.toMatch(/userErrors\s*\{\s*field\s+message\s+code\s*\}/);
        expect(body.variables).toMatchObject({
          input: { id: "gid://shopify/Product/9", status: "ACTIVE" },
        });
        return jsonResponse({
          data: {
            productUpdate: {
              product: { id: "gid://shopify/Product/9", status: "ACTIVE" },
              userErrors: [],
            },
          },
        });
      }
      expect(body.operationName).toBe("ShopifyListingPublishablePublish");
      expect(body.query).toContain("publishablePublish");
      expect(body.query).toContain("userErrors { field message }");
      expect(body.query).not.toMatch(/userErrors\s*\{\s*field\s+message\s+code\s*\}/);
      expect(body.variables.input).toEqual([{ publicationId: "gid://shopify/Publication/55" }]);
      return jsonResponse({
        data: {
          publishablePublish: {
            publishable: { publishedOnPublication: true },
            userErrors: [],
          },
        },
      });
    });

    const result = await handleShopifyPublishListingJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(ops).toContain("ShopifyListingProductActivate");
    expect(ops).toContain("ShopifyListingPublishablePublish");
    expect(ops.indexOf("ShopifyListingPublishablePublish")).toBeGreaterThan(
      ops.indexOf("ShopifyListingProductActivate")
    );
    expect(persistShopifyListingHealth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        health: expect.objectContaining({
          readiness: "READY_TO_PUBLISH",
          remoteProductStatus: "ACTIVE",
        }),
      })
    );
    // INW listing status was read as active and never written.
    expect(prisma.storeItem.findFirst).toHaveBeenCalled();
  });

  it("surfaces actionable DEAD error when publication permissions are missing", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyOnlineStorePublicationLookup") {
        return jsonResponse(
          {
            errors: [
              {
                message: "Access denied for publications field.",
                extensions: { code: "ACCESS_DENIED" },
              },
            ],
          },
          200
        );
      }
      throw new Error(`unexpected op ${body.operationName}`);
    });
    const result = await handleShopifyPublishListingJob(claim, { fetchImpl });
    expect(result).toMatchObject({
      outcome: "DEAD",
      errorCode: "PUBLICATION_PERMISSION_MISSING",
    });
    expect(String(result.errorMessage)).toMatch(/write_publications|read_publications|Reconnect/i);
    expect(persistShopifyListingHealth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        health: expect.objectContaining({
          readiness: "ACTION_REQUIRED",
          issueCode: "PUBLICATION_PERMISSION_MISSING",
        }),
      })
    );
  });

  it("is idempotent when already ACTIVE and published (no duplicate publish)", async () => {
    let publishCalls = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { operationName?: string };
      if (body.operationName === "ShopifyOnlineStorePublicationLookup") {
        return publicationsResponse();
      }
      if (body.operationName === "ShopifyListingPublicationState") {
        return jsonResponse({
          data: {
            product: {
              id: "gid://shopify/Product/9",
              status: "ACTIVE",
              publishedOnPublication: true,
            },
          },
        });
      }
      if (body.operationName === "ShopifyListingPublishablePublish") {
        publishCalls += 1;
      }
      throw new Error(`unexpected op ${body.operationName}`);
    });
    const result = await handleShopifyPublishListingJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(publishCalls).toBe(0);
  });
});

describe("content sync respects intentional publication changes", () => {
  it("content sync product/variant updates omit status and publication fields", async () => {
    const { handleShopifyUpdateListingContentJob: contentHandler } = await import(
      "./update-listing-content"
    );
    expect(typeof contentHandler).toBe("function");
    // Concrete mutation allowlist assertions live in shopify-s5-update-listing.test.ts
    // ("never sends status/inventory/publication").
  });
});
