import { createHash, createHmac } from "crypto";
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

import {
  consumeShopifyOAuthState,
  createShopifyOAuthState,
  readShopifyOAuthBrowserBindingHash,
} from "database";
import { GET as callbackGet } from "@/app/api/shopify/oauth/callback/route";
import { beginShopifyConnect, completeShopifyOAuth } from "./connect";
import { signShopifyOAuthState } from "./oauth-state";

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

describe("shopify oauth shop mismatch diagnostics", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
    process.env.SHOPIFY_CLIENT_ID = config.clientId;
    process.env.SHOPIFY_CLIENT_SECRET = config.clientSecret;
    process.env.SHOPIFY_APP_URL = config.appUrl;
    vi.mocked(createShopifyOAuthState).mockReset();
    vi.mocked(createShopifyOAuthState).mockResolvedValue(undefined as never);
    vi.mocked(readShopifyOAuthBrowserBindingHash).mockReset();
    vi.mocked(consumeShopifyOAuthState).mockReset();
    vi.mocked(readShopifyOAuthBrowserBindingHash).mockResolvedValue(BROWSER_HASH);
    vi.mocked(consumeShopifyOAuthState).mockResolvedValue("ok");
  });

  it("same-shop northwestcommunity flow reaches token exchange (shop match unchanged)", async () => {
    const begun = await beginShopifyConnect("member-a", "northwestcommunity.myshopify.com", {
      config,
    });
    const state = new URL(begun.authorizeUrl).searchParams.get("state")!;
    const params = hmacParams({
      code: "auth-code",
      shop: "northwestcommunity.myshopify.com",
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
    expect(consumeShopifyOAuthState).toHaveBeenCalled();
  });

  it("shop A vs shop B rejects with SIGNED_STATE_SHOP_MISMATCH and shop identity fields", async () => {
    const nonce = "c".repeat(64);
    const state = await signShopifyOAuthState({
      memberId: "member-a",
      shopDomain: "shop-a.myshopify.com",
      nonce,
    });
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
      })
    ).rejects.toMatchObject({
      code: "invalid_state",
      reason: "SIGNED_STATE_SHOP_MISMATCH",
      diagnostic: {
        signedStateShop: "shop-a.myshopify.com",
        callbackShop: "shop-b.myshopify.com",
        rawCallbackShop: "shop-b.myshopify.com",
        attemptId: nonce.slice(0, 8),
      },
    });
    expect(consumeShopifyOAuthState).not.toHaveBeenCalled();
  });

  it("callback route logs the three shop fields without secrets", async () => {
    const nonce = "d".repeat(64);
    const state = await signShopifyOAuthState({
      memberId: "member-a",
      shopDomain: "shop-a.myshopify.com",
      nonce,
    });
    const params = hmacParams({
      code: "auth-code-SECRET-VALUE",
      shop: "shop-b.myshopify.com",
      state,
      timestamp: "1700000000",
    });
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args) => {
      logs.push(args);
    });
    const qs = new URLSearchParams(params).toString();
    await callbackGet(
      new NextRequest(`https://www.inwcommunity.com/api/shopify/oauth/callback?${qs}`, {
        headers: { cookie: `shopify_oauth_browser=${BROWSER_SECRET}` },
      })
    );
    spy.mockRestore();
    const rejected = logs.find(
      (entry) => Array.isArray(entry) && entry[0] === "SHOPIFY_OAUTH_STATE_REJECTED"
    ) as [string, Record<string, unknown>] | undefined;
    expect(rejected).toBeTruthy();
    const payload = rejected![1];
    expect(payload).toMatchObject({
      reason: "SIGNED_STATE_SHOP_MISMATCH",
      host: "www.inwcommunity.com",
      path: "/api/shopify/oauth/callback",
      bindingCookiePresent: true,
      signedStateShop: "shop-a.myshopify.com",
      callbackShop: "shop-b.myshopify.com",
      rawCallbackShop: "shop-b.myshopify.com",
      attemptId: nonce.slice(0, 8),
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(state);
    expect(serialized).not.toContain("auth-code-SECRET-VALUE");
    expect(serialized).not.toContain(BROWSER_SECRET);
    expect(serialized).not.toContain(config.clientSecret);
  });
});
