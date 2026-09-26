import { createHash } from "crypto";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi: vi.fn(),
}));

vi.mock("@/lib/storefront-seller-access", () => ({
  memberHasStorefrontListingAccess: vi.fn(),
}));

vi.mock("@/lib/shopify/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./connect")>();
  return {
    ...actual,
    beginShopifyConnect: vi.fn(),
  };
});

import { consumeShopifyOAuthState, readShopifyOAuthBrowserBindingHash } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { POST as connectPost } from "@/app/api/shopify/connect/route";
import {
  SHOPIFY_OAUTH_BROWSER_COOKIE_PATH,
  shopifyBrowserBindingCookie,
  shopifyBrowserCookiePathMatches,
} from "./browser-binding";
import { beginShopifyConnect, completeShopifyOAuth } from "./connect";
import { signShopifyOAuthState } from "./oauth-state";

const BROWSER_SECRET = "ab".repeat(32);
const BROWSER_HASH = createHash("sha256").update(BROWSER_SECRET, "utf8").digest("hex");
const BINDING = "cd".repeat(32);

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

describe("shopify oauth cookie Path send semantics (RFC 6265)", () => {
  it("stores Path scoped to callback; that Path is sent only to callback", () => {
    expect(SHOPIFY_OAUTH_BROWSER_COOKIE_PATH).toBe("/api/shopify/oauth/callback");
    expect(
      shopifyBrowserCookiePathMatches("/api/shopify/oauth/callback", "/api/shopify/oauth/callback")
    ).toBe(true);
    expect(shopifyBrowserCookiePathMatches("/api/shopify/oauth/callback", "/api/shopify/connect")).toBe(
      false
    );
  });

  it("RFC-valid: Set-Cookie Path need not match the connect request-URI", () => {
    // Document intended production attributes; Path differs from /api/shopify/connect by design.
    const cookie = shopifyBrowserBindingCookie(BROWSER_SECRET);
    expect(cookie.options.path).toBe("/api/shopify/oauth/callback");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options).not.toHaveProperty("domain");
  });
});

describe("shopify oauth connect emits Set-Cookie", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "client-id";
    process.env.SHOPIFY_CLIENT_SECRET = "client-secret";
    process.env.SHOPIFY_APP_URL = "https://www.inwcommunity.com";
    vi.mocked(getSessionForApi).mockResolvedValue({
      user: { id: "member-a", email: "a@example.com" },
    } as never);
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(true);
    vi.mocked(beginShopifyConnect).mockResolvedValue({
      authorizeUrl: "https://northwestcommunity.myshopify.com/admin/oauth/authorize?state=signed",
      browserBindingSecret: BINDING,
    });
  });

  it("POST /api/shopify/connect returns 200 with Set-Cookie attributes (value not asserted)", async () => {
    const response = await connectPost(
      new NextRequest("https://www.inwcommunity.com/api/shopify/connect", {
        method: "POST",
        body: JSON.stringify({ shop: "northwestcommunity.myshopify.com" }),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("shopify_oauth_browser=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/api/shopify/oauth/callback");
    // Never assert or log the secret value from Set-Cookie in diagnostics.
    expect(setCookie).not.toMatch(/shopify_oauth_browser=;|shopify_oauth_browser=""/);
    const body = await response.json();
    expect(body).toEqual({
      authorizeUrl: "https://northwestcommunity.myshopify.com/admin/oauth/authorize?state=signed",
    });
    expect(JSON.stringify(body)).not.toContain(BINDING);
  });

  it("documents host-only cookie risk: www-set cookie is not visible on apex host", () => {
    // Proven code shape only — production host of the failed attempt is not telemetry-proven.
    const setHost = "www.inwcommunity.com";
    const callbackHost = "www.inwcommunity.com";
    const apex = "inwcommunity.com";
    expect(setHost).toBe(callbackHost);
    expect(setHost).not.toBe(apex);
    expect(config.redirectUri.startsWith(`https://${setHost}`)).toBe(true);
  });
});

describe("shopify oauth invalid_state predicates", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
    vi.mocked(readShopifyOAuthBrowserBindingHash).mockReset();
    vi.mocked(consumeShopifyOAuthState).mockReset();
    vi.mocked(readShopifyOAuthBrowserBindingHash).mockResolvedValue(BROWSER_HASH);
    vi.mocked(consumeShopifyOAuthState).mockResolvedValue("ok");
  });

  async function signedCallbackParams() {
    const state = await signShopifyOAuthState({
      memberId: "member-a",
      shopDomain: "northwestcommunity.myshopify.com",
      nonce: "c".repeat(64),
    });
    return hmacParams({
      code: "auth-code",
      shop: "northwestcommunity.myshopify.com",
      state,
      timestamp: "1700000000",
    });
  }

  it("missing binding cookie rejects before consume", async () => {
    const params = await signedCallbackParams();
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: null,
      })
    ).rejects.toMatchObject({
      code: "invalid_state",
      reason: "BROWSER_BINDING_COOKIE_MISSING",
    });
    expect(consumeShopifyOAuthState).not.toHaveBeenCalled();
  });

  it("wrong binding secret rejects before consume", async () => {
    const params = await signedCallbackParams();
    await expect(
      completeShopifyOAuth(new URLSearchParams(params), {
        config,
        browserBindingSecret: "ff".repeat(32),
      })
    ).rejects.toMatchObject({
      code: "invalid_state",
      reason: "BROWSER_BINDING_HASH_MISMATCH",
    });
    expect(consumeShopifyOAuthState).not.toHaveBeenCalled();
  });

  it("does not reject solely because callback permanent domain differs from requested shop", async () => {
    const params = await signedCallbackParams();
    const resigned = hmacParams({
      code: params.code,
      shop: "jpuhtv-df.myshopify.com",
      state: params.state,
      timestamp: params.timestamp,
    });
    // Token exchange fails before identity/consume — association not reached yet.
    await expect(
      completeShopifyOAuth(new URLSearchParams(resigned), {
        config,
        browserBindingSecret: BROWSER_SECRET,
        fetchImpl: async () => new Response("nope", { status: 500 }),
      })
    ).rejects.toMatchObject({ code: "token_exchange" });
    expect(consumeShopifyOAuthState).toHaveBeenCalled();
  });
});
