import { createHash, createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";
const REFRESH = "shprt_test_refresh_token_value";

vi.mock("database", () => ({
  prisma: {},
  createShopifyOAuthState: vi.fn(),
  consumeShopifyOAuthState: vi.fn(),
  readShopifyOAuthBrowserBindingHash: vi.fn(),
  persistShopifyInstall: vi.fn(),
  rotateShopifyTokenMaterial: vi.fn(),
}));

vi.mock("@/lib/encrypt", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
}));

import {
  consumeShopifyOAuthState,
  createShopifyOAuthState,
  persistShopifyInstall,
  readShopifyOAuthBrowserBindingHash,
} from "database";
import { beginShopifyConnect, completeShopifyOAuth } from "./connect";
import { normalizeShopifyShopDomain } from "./shop-domain";

const BROWSER_SECRET = "ab".repeat(32);
const BROWSER_HASH = createHash("sha256").update(BROWSER_SECRET, "utf8").digest("hex");

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  appUrl: "https://www.inwcommunity.com",
  redirectUri: "https://www.inwcommunity.com/api/shopify/oauth/callback",
  uninstallWebhookUri: "https://www.inwcommunity.com/api/shopify/webhooks/uninstalled",
  providerEvidenceWebhookUri: "https://www.inwcommunity.com/api/shopify/webhooks/inbox",
  scopes: [
    "read_products",
    "write_products",
    "read_inventory",
    "write_inventory",
    "read_orders",
    "read_locations",
  ],
  apiVersion: "2026-07",
};

function hmacParams(params: Record<string, string>) {
  const message = Object.entries(params)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return {
    ...params,
    hmac: createHmac("sha256", config.clientSecret).update(message).digest("hex"),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("shopify oauth rename / permanent domain identity", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
    vi.mocked(createShopifyOAuthState).mockReset();
    vi.mocked(createShopifyOAuthState).mockResolvedValue(undefined as never);
    vi.mocked(consumeShopifyOAuthState).mockReset();
    vi.mocked(persistShopifyInstall).mockReset();
    vi.mocked(readShopifyOAuthBrowserBindingHash).mockReset();
    vi.mocked(readShopifyOAuthBrowserBindingHash).mockResolvedValue(BROWSER_HASH);
    vi.mocked(consumeShopifyOAuthState).mockResolvedValue("ok");
    vi.mocked(persistShopifyInstall).mockImplementation(async (_db, input) => ({
      id: "conn-1",
      memberId: input.memberId,
      shopDomain: input.shopDomain,
      shopId: input.shopId,
      generation: 1,
      grantedScopes: input.grantedScopes,
      status: "ACTIVE",
      primaryLocationId: input.primaryLocationId,
      connectedAt: new Date("2026-09-24T00:00:00Z"),
      disconnectedAt: null,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      createdAt: new Date("2026-09-24T00:00:00Z"),
      updatedAt: new Date("2026-09-24T00:00:00Z"),
    }));
  });

  function shopifyFetch(opts: {
    permanentDomain: string;
    shopId?: string;
    domains?: string[];
    identityMismatchDomain?: string;
  }) {
    const shopId = opts.shopId ?? "gid://shopify/Shop/99";
    let productsUpdateCreated = false;
    let ordersPaidCreated = false;
    return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/admin/oauth/access_token")) {
        expect(href).toContain(`https://${opts.permanentDomain}/`);
        return jsonResponse({
          access_token: ACCESS,
          refresh_token: REFRESH,
          scope: config.scopes.join(","),
          expires_in: 3600,
          refresh_token_expires_in: 7776000,
        });
      }
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("ShopifyShopIdentity")) {
        return jsonResponse({
          data: {
            shop: {
              id: shopId,
              myshopifyDomain: opts.identityMismatchDomain ?? opts.permanentDomain,
              name: "Northwest Community",
              primaryDomain: { host: opts.permanentDomain, url: `https://${opts.permanentDomain}` },
            },
          },
        });
      }
      if (body.query.includes("ShopifyShopDomains")) {
        if (!opts.domains) {
          return jsonResponse({ errors: [{ message: "Access denied for domains field" }] }, 200);
        }
        return jsonResponse({
          data: {
            shop: {
              domains: opts.domains.map((host) => ({ host, url: `https://${host}` })),
            },
          },
        });
      }
      if (body.query.includes("ShopifyInventoryLocations")) {
        return jsonResponse({
          data: {
            locations: {
              nodes: [
                {
                  id: "gid://shopify/Location/1",
                  name: "Main",
                  isActive: true,
                  fulfillsOnlineOrders: true,
                  fulfillmentService: null,
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (body.query.includes("ShopifyProductsUpdateWebhookSubscriptions")) {
        return jsonResponse({
          data: {
            webhookSubscriptions: {
              nodes: productsUpdateCreated
                ? [
                    {
                      id: "gid://shopify/WebhookSubscription/55",
                      topic: "PRODUCTS_UPDATE",
                      endpoint: {
                        __typename: "WebhookHttpEndpoint",
                        callbackUrl: config.providerEvidenceWebhookUri,
                      },
                    },
                  ]
                : [],
            },
          },
        });
      }
      if (body.query.includes("ShopifyOrdersPaidWebhookSubscriptions")) {
        return jsonResponse({
          data: {
            webhookSubscriptions: {
              nodes: ordersPaidCreated
                ? [
                    {
                      id: "gid://shopify/WebhookSubscription/66",
                      topic: "ORDERS_PAID",
                      endpoint: {
                        __typename: "WebhookHttpEndpoint",
                        callbackUrl: config.providerEvidenceWebhookUri,
                      },
                    },
                  ]
                : [],
            },
          },
        });
      }
      if (body.query.includes("PRODUCTS_UPDATE")) {
        productsUpdateCreated = true;
        return jsonResponse({
          data: {
            webhookSubscriptionCreate: {
              userErrors: [],
              webhookSubscription: {
                id: "gid://shopify/WebhookSubscription/55",
                topic: "PRODUCTS_UPDATE",
              },
            },
          },
        });
      }
      if (body.query.includes("ORDERS_PAID")) {
        ordersPaidCreated = true;
        return jsonResponse({
          data: {
            webhookSubscriptionCreate: {
              userErrors: [],
              webhookSubscription: {
                id: "gid://shopify/WebhookSubscription/66",
                topic: "ORDERS_PAID",
              },
            },
          },
        });
      }
      if (body.query.includes("APP_UNINSTALLED")) {
        return jsonResponse({
          data: {
            webhookSubscriptionCreate: {
              userErrors: [],
              webhookSubscription: { id: "gid://shopify/WebhookSubscription/1" },
            },
          },
        });
      }
      return jsonResponse({ errors: [{ message: "unexpected" }] }, 200);
    });
  }

  it("production rename case: requested alias ≠ callback permanent domain → PASS", async () => {
    expect(normalizeShopifyShopDomain("https://northwestcommunity.myshopify.com/")).toBe(
      "northwestcommunity.myshopify.com"
    );
    const begun = await beginShopifyConnect("member-a", "northwestcommunity.myshopify.com", {
      config,
    });
    expect(begun.authorizeUrl.startsWith("https://northwestcommunity.myshopify.com/")).toBe(true);
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "jpuhtv-df.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    const connection = await completeShopifyOAuth(new URLSearchParams(params), {
      config,
      browserBindingSecret: BROWSER_SECRET,
      fetchImpl: shopifyFetch({
        permanentDomain: "jpuhtv-df.myshopify.com",
        shopId: "gid://shopify/Shop/4242",
        domains: ["jpuhtv-df.myshopify.com", "northwestcommunity.myshopify.com"],
      }),
    });
    expect(connection.shopDomain).toBe("jpuhtv-df.myshopify.com");
    expect(connection.shopId).toBe("gid://shopify/Shop/4242");
    expect(persistShopifyInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopDomain: "jpuhtv-df.myshopify.com",
        shopId: "gid://shopify/Shop/4242",
      })
    );
    expect(consumeShopifyOAuthState).toHaveBeenCalled();
  });

  it("exact same-domain case still succeeds", async () => {
    const begun = await beginShopifyConnect("member-a", "my-shop.myshopify.com", { config });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "my-shop.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    const connection = await completeShopifyOAuth(new URLSearchParams(params), {
      config,
      browserBindingSecret: BROWSER_SECRET,
      fetchImpl: shopifyFetch({ permanentDomain: "my-shop.myshopify.com" }),
    });
    expect(connection.shopDomain).toBe("my-shop.myshopify.com");
  });

  it("fails closed when Admin API myshopifyDomain ≠ callback shop", async () => {
    const begun = await beginShopifyConnect("member-a", "shop-b.myshopify.com", { config });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "shop-b.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: BROWSER_SECRET,
        fetchImpl: shopifyFetch({
          permanentDomain: "shop-b.myshopify.com",
          identityMismatchDomain: "shop-c.myshopify.com",
        }),
      })
    ).rejects.toMatchObject({ code: "shop_identity" });
    expect(persistShopifyInstall).not.toHaveBeenCalled();
    expect(consumeShopifyOAuthState).toHaveBeenCalled();
  });

  it("cross-shop negative: requested not in domains → FAIL CLOSED; state remains consumed", async () => {
    const begun = await beginShopifyConnect("member-a", "shop-a.myshopify.com", { config });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "shop-b.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: BROWSER_SECRET,
        fetchImpl: shopifyFetch({
          permanentDomain: "shop-b.myshopify.com",
          domains: ["shop-b.myshopify.com", "other.myshopify.com"],
        }),
      })
    ).rejects.toMatchObject({
      code: "shop_identity",
      reason: "REQUESTED_SHOP_NOT_ASSOCIATED",
    });
    expect(persistShopifyInstall).not.toHaveBeenCalled();
    expect(consumeShopifyOAuthState).toHaveBeenCalledTimes(1);
  });

  it("domains query unavailable → FAIL CLOSED; state remains consumed", async () => {
    const begun = await beginShopifyConnect("member-a", "northwestcommunity.myshopify.com", {
      config,
    });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "jpuhtv-df.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: BROWSER_SECRET,
        fetchImpl: shopifyFetch({
          permanentDomain: "jpuhtv-df.myshopify.com",
          // domains omitted → GraphQL error path
        }),
      })
    ).rejects.toMatchObject({
      code: "shop_identity",
      reason: "SHOP_DOMAIN_ASSOCIATION_UNVERIFIED",
    });
    expect(persistShopifyInstall).not.toHaveBeenCalled();
    expect(consumeShopifyOAuthState).toHaveBeenCalledTimes(1);
  });

  it("token exchange failure: state consumed before exchange; connection not created", async () => {
    const begun = await beginShopifyConnect("member-a", "northwestcommunity.myshopify.com", {
      config,
    });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "jpuhtv-df.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: BROWSER_SECRET,
        fetchImpl: async () => new Response("nope", { status: 500 }),
      })
    ).rejects.toMatchObject({ code: "token_exchange" });
    expect(consumeShopifyOAuthState).toHaveBeenCalledTimes(1);
    expect(persistShopifyInstall).not.toHaveBeenCalled();
  });

  it("replay: second callback rejects after first consume; no second token exchange", async () => {
    const begun = await beginShopifyConnect("member-a", "my-shop.myshopify.com", { config });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "my-shop.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    const fetchImpl = shopifyFetch({ permanentDomain: "my-shop.myshopify.com" });
    await completeShopifyOAuth(new URLSearchParams(params), {
      config,
      browserBindingSecret: BROWSER_SECRET,
      fetchImpl,
    });
    expect(consumeShopifyOAuthState).toHaveBeenCalledTimes(1);
    const tokenCallsAfterFirst = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).includes("/admin/oauth/access_token")
    ).length;
    expect(tokenCallsAfterFirst).toBe(1);

    vi.mocked(consumeShopifyOAuthState).mockResolvedValue("rejected");
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: BROWSER_SECRET,
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: "invalid_state", reason: "STATE_CONSUME_REJECTED" });
    const tokenCallsAfterSecond = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).includes("/admin/oauth/access_token")
    ).length;
    expect(tokenCallsAfterSecond).toBe(1);
    expect(persistShopifyInstall).toHaveBeenCalledTimes(1);
  });
});
