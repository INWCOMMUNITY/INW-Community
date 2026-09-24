import { createHmac } from "crypto";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";
const REFRESH = "shprt_test_refresh_token_value";

vi.mock("database", () => ({
  prisma: {},
  createShopifyOAuthState: vi.fn(),
  consumeShopifyOAuthState: vi.fn(),
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
} from "database";
import { exchangeShopifyAuthorizationCode } from "./client";
import { completeShopifyOAuth, toPublicShopifyConnection } from "./connect";
import { verifyShopifyOAuthHmac, verifyShopifyWebhookHmac } from "./hmac";
import { selectInventoryLocations } from "./locations";
import { signShopifyOAuthState, verifyShopifyOAuthState } from "./oauth-state";
import { missingShopifyScopes } from "./scopes";
import { normalizeShopifyShopDomain } from "./shop-domain";
import { redactShopifySecrets } from "./redact";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  appUrl: "https://app.example.com",
  redirectUri: "https://app.example.com/api/shopify/oauth/callback",
  uninstallWebhookUri: "https://app.example.com/api/shopify/webhooks/uninstalled",
  scopes: ["read_products", "write_products", "read_inventory", "write_inventory", "read_orders", "read_locations"],
  apiVersion: "2026-07",
};

function hmacParams(params: Record<string, string>, secret = config.clientSecret) {
  const message = Object.entries(params)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return { ...params, hmac: createHmac("sha256", secret).update(message).digest("hex") };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("shop domain", () => {
  it("canonicalizes a valid myshopify hostname", () => {
    expect(normalizeShopifyShopDomain("  My-Shop.myshopify.com ")).toBe("my-shop.myshopify.com");
  });

  it("rejects arbitrary domains and injected URLs", () => {
    expect(normalizeShopifyShopDomain("evil.com")).toBeNull();
    expect(normalizeShopifyShopDomain("https://my-shop.myshopify.com/admin")).toBeNull();
    expect(normalizeShopifyShopDomain("my-shop.myshopify.com?x=1")).toBeNull();
    expect(normalizeShopifyShopDomain("my-shop.myshopify.com.evil.com")).toBeNull();
    expect(normalizeShopifyShopDomain("")).toBeNull();
    expect(normalizeShopifyShopDomain("-bad.myshopify.com")).toBeNull();
  });
});

describe("oauth state", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
  });

  it("accepts a signed state for the same member and shop", async () => {
    const state = await signShopifyOAuthState({
      memberId: "member-a",
      shopDomain: "my-shop.myshopify.com",
      nonce: "a".repeat(64),
    });
    await expect(verifyShopifyOAuthState(state)).resolves.toEqual({
      memberId: "member-a",
      shopDomain: "my-shop.myshopify.com",
      nonce: "a".repeat(64),
    });
  });

  it("rejects an expired state", async () => {
    const state = await new SignJWT({
      shopDomain: "my-shop.myshopify.com",
      nonce: "b".repeat(64),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("member-a")
      .setIssuer("nwc-shopify-oauth")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));
    await expect(verifyShopifyOAuthState(state)).resolves.toBeNull();
  });
});

describe("scopes and locations", () => {
  it("treats write as satisfying the matching read scope", () => {
    expect(missingShopifyScopes("write_products,write_inventory,read_orders,read_locations")).toEqual([]);
  });

  it("keeps only active online merchant locations", () => {
    const selected = selectInventoryLocations([
      {
        id: "gid://shopify/Location/1",
        name: "Online",
        isActive: true,
        fulfillsOnlineOrders: true,
        fulfillmentService: null,
      },
      {
        id: "gid://shopify/Location/2",
        name: "Retail only",
        isActive: true,
        fulfillsOnlineOrders: false,
        fulfillmentService: null,
      },
      {
        id: "gid://shopify/Location/3",
        name: "App",
        isActive: true,
        fulfillsOnlineOrders: true,
        fulfillmentService: { id: "gid://shopify/FulfillmentService/1" },
      },
      {
        id: "not-a-gid",
        name: "Bad",
        isActive: true,
        fulfillsOnlineOrders: true,
        fulfillmentService: null,
      },
    ]);
    expect(selected.map((location) => location.id)).toEqual(["gid://shopify/Location/1"]);
  });
});

describe("oauth callback", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
    process.env.ENCRYPTION_KEY = "test-encryption-key-value";
    vi.mocked(createShopifyOAuthState).mockReset();
    vi.mocked(consumeShopifyOAuthState).mockReset();
    vi.mocked(persistShopifyInstall).mockReset();
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

  function shopifyFetch(locations: { id: string; name: string }[]) {
    return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/admin/oauth/access_token")) {
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
          data: { shop: { id: "gid://shopify/Shop/99", myshopifyDomain: "my-shop.myshopify.com" } },
        });
      }
      if (body.query.includes("ShopifyInventoryLocations")) {
        return jsonResponse({
          data: {
            locations: {
              nodes: locations.map((location) => ({
                ...location,
                isActive: true,
                fulfillsOnlineOrders: true,
                fulfillmentService: null,
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (body.query.includes("webhookSubscriptionCreate")) {
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

  async function callbackParams(shop = "my-shop.myshopify.com") {
    const state = await signShopifyOAuthState({
      memberId: "member-a",
      shopDomain: "my-shop.myshopify.com",
      nonce: "c".repeat(64),
    });
    return hmacParams({
      code: "auth-code",
      shop,
      state,
      timestamp: "1700000000",
    });
  }

  it("persists the shop GID and auto-binds a single location without exposing tokens", async () => {
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logs.push(args);
    });
    const params = await callbackParams();
    const connection = await completeShopifyOAuth(new URLSearchParams(params), {
      config,
      fetchImpl: shopifyFetch([{ id: "gid://shopify/Location/1", name: "Main" }]),
    });
    expect(connection.shopId).toBe("gid://shopify/Shop/99");
    expect(connection.primaryLocationId).toBe("gid://shopify/Location/1");
    expect(persistShopifyInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        memberId: "member-a",
        shopDomain: "my-shop.myshopify.com",
        shopId: "gid://shopify/Shop/99",
        accessTokenEncrypted: `enc:${ACCESS}`,
        refreshTokenEncrypted: `enc:${REFRESH}`,
        primaryLocationId: "gid://shopify/Location/1",
      })
    );
    const serialized = JSON.stringify(toPublicShopifyConnection(connection));
    expect(serialized).not.toContain(ACCESS);
    expect(serialized).not.toContain(REFRESH);
    expect(JSON.stringify(logs)).not.toContain(ACCESS);
    spy.mockRestore();
  });

  it("leaves the primary location unset when several locations exist", async () => {
    const params = await callbackParams();
    await completeShopifyOAuth(new URLSearchParams(params), {
      config,
      fetchImpl: shopifyFetch([
        { id: "gid://shopify/Location/1", name: "A" },
        { id: "gid://shopify/Location/2", name: "B" },
      ]),
    });
    expect(persistShopifyInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ primaryLocationId: null })
    );
  });

  it("rejects a callback shop that does not match the signed state", async () => {
    const params = await callbackParams("other-shop.myshopify.com");
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), { config, fetchImpl: shopifyFetch([]) })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(consumeShopifyOAuthState).not.toHaveBeenCalled();
    expect(persistShopifyInstall).not.toHaveBeenCalled();
  });

  it("rejects a replayed state", async () => {
    vi.mocked(consumeShopifyOAuthState).mockResolvedValue("rejected");
    const params = await callbackParams();
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), { config, fetchImpl: shopifyFetch([]) })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(persistShopifyInstall).not.toHaveBeenCalled();
  });

  it("does not put the provider token in a failed exchange error", async () => {
    const params = await callbackParams();
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: ACCESS, error: ACCESS }, 400));
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), { config, fetchImpl })
    ).rejects.toThrow(/token exchange failed/i);
    try {
      await exchangeShopifyAuthorizationCode({
        shopDomain: "my-shop.myshopify.com",
        code: "auth-code",
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        fetchImpl,
      });
    } catch (error) {
      expect(String(error)).not.toContain(ACCESS);
    }
  });
});

describe("hmac", () => {
  it("accepts a valid oauth query hmac and rejects a tampered one", () => {
    const params = hmacParams({ code: "abc", shop: "my-shop.myshopify.com", state: "state", timestamp: "1" });
    expect(verifyShopifyOAuthHmac(params, config.clientSecret)).toBe(true);
    expect(verifyShopifyOAuthHmac({ ...params, shop: "other.myshopify.com" }, config.clientSecret)).toBe(false);
  });

  it("verifies the uninstall webhook body", () => {
    const body = JSON.stringify({ myshopify_domain: "my-shop.myshopify.com" });
    const digest = createHmac("sha256", config.clientSecret).update(body, "utf8").digest("base64");
    expect(verifyShopifyWebhookHmac(body, digest, config.clientSecret)).toBe(true);
    expect(verifyShopifyWebhookHmac(body, digest, "other-secret")).toBe(false);
  });
});

describe("redaction", () => {
  it("removes token-shaped secrets", () => {
    expect(redactShopifySecrets(`token ${ACCESS} and ${REFRESH}`)).toBe("token [redacted] and [redacted]");
  });

  it("stores a token only as ciphertext with the real encrypt helper", async () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-value-32b!";
    const actual = await vi.importActual<typeof import("@/lib/encrypt")>("@/lib/encrypt");
    const cipher = actual.encrypt(ACCESS);
    expect(cipher).not.toContain(ACCESS);
    expect(actual.decrypt(cipher)).toBe(ACCESS);
  });
});
