import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyProviderEvidence: { findUnique: vi.fn() },
      shopifyConnection: { findUnique: vi.fn() },
      shopifyListingLink: { findUnique: vi.fn() },
      shopifyVariantMap: { findMany: vi.fn() },
      shopifySyncJob: { count: vi.fn() },
    },
    applyShopifyProductsUpdateObservation: vi.fn(),
    markShopifyEvidenceIgnored: vi.fn(),
    markShopifyEvidenceError: vi.fn(),
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
  applyShopifyProductsUpdateObservation,
  markShopifyEvidenceError,
  markShopifyEvidenceIgnored,
  prisma,
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
} from "database";
import { handleShopifyProcessProviderEvidenceJob } from "./process-products-update";
import { ensureShopifyProductsUpdateWebhook } from "./client";

const connection = {
  id: "conn-gen-1",
  memberId: "member-a",
  shopDomain: "my-shop.myshopify.com",
  status: "ACTIVE",
  accessTokenEncrypted: "enc",
  refreshTokenEncrypted: "enc-r",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
  grantedScopes: "write_products",
};

const listing = {
  id: "link-1",
  shopifyConnectionId: "conn-gen-1",
  memberId: "member-a",
  storeItemId: "item-1",
  shopifyProductId: "gid://shopify/Product/9",
};

const variantMap = {
  id: "vmap-1",
  shopifyConnectionId: "conn-gen-1",
  shopifyListingLinkId: "link-1",
  storeVariantId: "var-1",
  shopifyVariantId: "gid://shopify/ProductVariant/8",
};

const claim = {
  id: "job-1",
  shopifyConnectionId: "conn-gen-1",
  kind: "PROCESS_PROVIDER_EVIDENCE" as const,
  dedupeKey: "PROCESS_PROVIDER_EVIDENCE:wh-1",
  evidenceId: "ev-1",
  payload: { evidenceId: "ev-1", webhookId: "wh-1", topic: "products/update" },
  payloadHash: "hash",
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "w1",
  leaseToken: "tok",
  leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

function evidenceRow(overrides?: Record<string, unknown>) {
  return {
    id: "ev-1",
    shopifyConnectionId: "conn-gen-1",
    topic: "products/update",
    processState: "RECEIVED",
    rawBody: JSON.stringify({
      admin_graphql_api_id: "gid://shopify/Product/9",
      id: 9,
      title: "Ignored Body Title",
    }),
    lastErrorCode: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

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
  productUpdatedAt?: string;
  variantUpdatedAt?: string;
  variants?: Array<{
    id: string;
    price: string;
    sku: string | null;
    updatedAt: string;
    inventoryItemId: string | null;
  }>;
}) {
  return jsonResponse({
    data: {
      product: {
        id: "gid://shopify/Product/9",
        status: input.status ?? "DRAFT",
        title: input.title ?? "Remote Title",
        descriptionHtml: input.descriptionHtml ?? "Remote Desc",
        updatedAt: input.productUpdatedAt ?? "2026-09-25T12:00:00Z",
        variants: {
          nodes: input.variants ?? [
            {
              id: "gid://shopify/ProductVariant/8",
              price: input.price ?? "10.37",
              sku: input.sku ?? "SKU-R",
              updatedAt: input.variantUpdatedAt ?? "2026-09-25T12:00:00Z",
              inventoryItem: { id: "gid://shopify/InventoryItem/7" },
            },
          ],
        },
      },
    },
  });
}

describe("ensureShopifyProductsUpdateWebhook", () => {
  it("reuses an equivalent PRODUCTS_UPDATE subscription", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      expect(body.query).toContain("PRODUCTS_UPDATE");
      expect(body.query).not.toMatch(/ORDERS_|INVENTORY_LEVELS|PRODUCTS_DELETE|PRODUCTS_CREATE/);
      return jsonResponse({
        data: {
          webhookSubscriptions: {
            nodes: [
              {
                id: "gid://shopify/WebhookSubscription/99",
                topic: "PRODUCTS_UPDATE",
                endpoint: {
                  __typename: "WebhookHttpEndpoint",
                  callbackUrl: "https://app.example.com/api/shopify/webhooks/inbox",
                },
              },
            ],
          },
        },
      });
    });
    const result = await ensureShopifyProductsUpdateWebhook({
      shopDomain: "my-shop.myshopify.com",
      accessToken: ACCESS,
      callbackUrl: "https://app.example.com/api/shopify/webhooks/inbox",
      fetchImpl,
    });
    expect(result).toEqual({
      status: "REUSED",
      subscriptionId: "gid://shopify/WebhookSubscription/99",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("creates once when absent and re-queries after unknown create", async () => {
    let creates = 0;
    let lists = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("ShopifyProductsUpdateWebhookSubscriptions")) {
        lists += 1;
        if (lists === 1) {
          return jsonResponse({ data: { webhookSubscriptions: { nodes: [] } } });
        }
        return jsonResponse({
          data: {
            webhookSubscriptions: {
              nodes: [
                {
                  id: "gid://shopify/WebhookSubscription/55",
                  topic: "PRODUCTS_UPDATE",
                  endpoint: {
                    __typename: "WebhookHttpEndpoint",
                    callbackUrl: "https://app.example.com/api/shopify/webhooks/inbox",
                  },
                },
              ],
            },
          },
        });
      }
      creates += 1;
      if (creates === 1) throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      return jsonResponse({
        data: {
          webhookSubscriptionCreate: {
            userErrors: [],
            webhookSubscription: { id: "gid://shopify/WebhookSubscription/55", topic: "PRODUCTS_UPDATE" },
          },
        },
      });
    });

    const result = await ensureShopifyProductsUpdateWebhook({
      shopDomain: "my-shop.myshopify.com",
      accessToken: ACCESS,
      callbackUrl: "https://app.example.com/api/shopify/webhooks/inbox",
      fetchImpl,
    });
    expect(result.subscriptionId).toBe("gid://shopify/WebhookSubscription/55");
    expect(creates).toBeGreaterThanOrEqual(1);
  });

  it("fails closed on incompatible existing callback URL", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          webhookSubscriptions: {
            nodes: [
              {
                id: "gid://shopify/WebhookSubscription/1",
                topic: "PRODUCTS_UPDATE",
                endpoint: {
                  __typename: "WebhookHttpEndpoint",
                  callbackUrl: "https://evil.example.com/hook",
                },
              },
            ],
          },
        },
      })
    );
    await expect(
      ensureShopifyProductsUpdateWebhook({
        shopDomain: "my-shop.myshopify.com",
        accessToken: ACCESS,
        callbackUrl: "https://app.example.com/api/shopify/webhooks/inbox",
        fetchImpl,
      })
    ).rejects.toThrow(/incompatible/i);
  });
});

describe("shopify PROCESS_PROVIDER_EVIDENCE products/update", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyProviderEvidence.findUnique).mockReset();
    vi.mocked(prisma.shopifyConnection.findUnique).mockReset();
    vi.mocked(prisma.shopifyListingLink.findUnique).mockReset();
    vi.mocked(prisma.shopifyVariantMap.findMany).mockReset();
    vi.mocked(applyShopifyProductsUpdateObservation).mockReset();
    vi.mocked(markShopifyEvidenceIgnored).mockReset();
    vi.mocked(markShopifyEvidenceError).mockReset();
  });

  it("ignores unmapped products without creating mappings/jobs", async () => {
    vi.mocked(prisma.shopifyProviderEvidence.findUnique).mockResolvedValue(evidenceRow() as never);
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue(null);
    const fetchImpl = vi.fn();
    const result = await handleShopifyProcessProviderEvidenceJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(markShopifyEvidenceIgnored).toHaveBeenCalledWith(
      expect.anything(),
      "ev-1",
      "UNMAPPED",
      expect.any(String)
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(applyShopifyProductsUpdateObservation).not.toHaveBeenCalled();
  });

  it("ignores inactive generation evidence", async () => {
    vi.mocked(prisma.shopifyProviderEvidence.findUnique).mockResolvedValue(evidenceRow() as never);
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue({
      ...connection,
      status: "DISCONNECTED",
    } as never);
    const fetchImpl = vi.fn();
    const result = await handleShopifyProcessProviderEvidenceJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(markShopifyEvidenceIgnored).toHaveBeenCalledWith(
      expect.anything(),
      "ev-1",
      "CONNECTION_INACTIVE",
      expect.any(String)
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries on provider read THROTTLED without marking PROCESSED", async () => {
    vi.mocked(prisma.shopifyProviderEvidence.findUnique).mockResolvedValue(evidenceRow() as never);
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue(listing as never);
    vi.mocked(prisma.shopifyVariantMap.findMany).mockResolvedValue([variantMap] as never);
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { errors: [{ message: "throttled", extensions: { code: "THROTTLED" } }] },
        429
      )
    );
    const result = await handleShopifyProcessProviderEvidenceJob(claim, { fetchImpl });
    expect(result).toMatchObject({ outcome: "RETRY", errorClass: "THROTTLED" });
    expect(applyShopifyProductsUpdateObservation).not.toHaveBeenCalled();
    expect(markShopifyEvidenceIgnored).not.toHaveBeenCalled();
  });

  it("errors on remote missing without deleting mapping", async () => {
    vi.mocked(prisma.shopifyProviderEvidence.findUnique).mockResolvedValue(evidenceRow() as never);
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue(listing as never);
    vi.mocked(prisma.shopifyVariantMap.findMany).mockResolvedValue([variantMap] as never);
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { product: null } }));
    const result = await handleShopifyProcessProviderEvidenceJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(markShopifyEvidenceError).toHaveBeenCalledWith(
      expect.anything(),
      "ev-1",
      "REMOTE_PRODUCT_MISSING",
      expect.any(String)
    );
  });

  it("passes re-read remote observation into apply (webhook body not used as content)", async () => {
    vi.mocked(prisma.shopifyProviderEvidence.findUnique).mockResolvedValue(evidenceRow() as never);
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue(listing as never);
    vi.mocked(prisma.shopifyVariantMap.findMany).mockResolvedValue([variantMap] as never);
    vi.mocked(applyShopifyProductsUpdateObservation).mockResolvedValue({
      status: "PROCESSED",
      productAction: "CONVERGED",
      variantAction: "CONVERGED",
    });
    const fetchImpl = vi.fn(async () =>
      remoteProduct({ title: "Live Title", descriptionHtml: "Live Desc", price: "10.37", sku: "SKU-R" })
    );
    const result = await handleShopifyProcessProviderEvidenceJob(claim, { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(applyShopifyProductsUpdateObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        evidenceId: "ev-1",
        connectionId: "conn-gen-1",
        listingLinkId: "link-1",
        mappedVariantId: "gid://shopify/ProductVariant/8",
        remote: expect.objectContaining({
          title: "Live Title",
          descriptionHtml: "Live Desc",
        }),
      })
    );
    const remoteFp = shopifyProductContentFingerprint({
      title: "Live Title",
      description: "Live Desc",
    });
    expect(remoteFp).toHaveLength(64);
    expect(shopifyVariantContentFingerprint({ priceCents: 1037, sku: "SKU-R" })).toHaveLength(64);
  });
});
