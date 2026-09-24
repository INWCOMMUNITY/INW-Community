import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {},
  revokeActiveShopifyConnectionsForShop: vi.fn(),
}));

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi: vi.fn(),
}));

vi.mock("@/lib/storefront-seller-access", () => ({
  memberHasStorefrontListingAccess: vi.fn(),
}));

vi.mock("@/lib/shopify/connect", () => ({
  beginShopifyConnect: vi.fn(),
  completeShopifyOAuth: vi.fn(),
  ShopifyConnectError: class ShopifyConnectError extends Error {
    code = "invalid_state";
  },
}));

import { revokeActiveShopifyConnectionsForShop } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { beginShopifyConnect, completeShopifyOAuth } from "@/lib/shopify/connect";
import { POST as connectPost } from "@/app/api/shopify/connect/route";
import { GET as callbackGet } from "@/app/api/shopify/oauth/callback/route";
import { POST as uninstallPost } from "@/app/api/shopify/webhooks/uninstalled/route";

const SECRET = "client-secret";
const BINDING = "cd".repeat(32);

function signedBody(body: string) {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
}

describe("shopify browser binding cookie", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "client-id";
    process.env.SHOPIFY_CLIENT_SECRET = SECRET;
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    vi.mocked(getSessionForApi).mockResolvedValue({ user: { id: "member-a", email: "a@example.com" } });
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(true);
    vi.mocked(beginShopifyConnect).mockResolvedValue({
      authorizeUrl: "https://my-shop.myshopify.com/admin/oauth/authorize?state=signed-state",
      browserBindingSecret: BINDING,
    });
    vi.mocked(completeShopifyOAuth).mockResolvedValue({
      id: "conn",
      memberId: "member-a",
      shopDomain: "my-shop.myshopify.com",
      shopId: "gid://shopify/Shop/1",
      generation: 1,
      grantedScopes: "read_products",
      status: "ACTIVE",
      primaryLocationId: null,
      connectedAt: new Date("2026-09-24T13:00:00Z"),
      disconnectedAt: null,
      accessTokenExpiresAt: new Date("2026-09-24T14:00:00Z"),
      refreshTokenExpiresAt: new Date("2026-12-23T00:00:00Z"),
      createdAt: new Date("2026-09-24T13:00:00Z"),
      updatedAt: new Date("2026-09-24T13:00:00Z"),
    });
  });

  it("sets an HttpOnly cookie and does not return or log the binding secret", async () => {
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logs.push(args);
    });
    const response = await connectPost(
      new NextRequest("https://app.example.com/api/shopify/connect", {
        method: "POST",
        body: JSON.stringify({ shop: "my-shop.myshopify.com" }),
      })
    );
    const body = await response.json();
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(body).toEqual({
      authorizeUrl: "https://my-shop.myshopify.com/admin/oauth/authorize?state=signed-state",
    });
    expect(JSON.stringify(body)).not.toContain(BINDING);
    expect(body.authorizeUrl).not.toContain(BINDING);
    expect(setCookie).toContain("shopify_oauth_browser=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/api/shopify/oauth/callback");
    expect(JSON.stringify(logs)).not.toContain(BINDING);
    spy.mockRestore();
  });

  it("clears the browser-binding cookie after the callback", async () => {
    const response = await callbackGet(
      new NextRequest("https://app.example.com/api/shopify/oauth/callback?code=1&shop=my-shop.myshopify.com", {
        headers: { cookie: `shopify_oauth_browser=${BINDING}` },
      })
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("shopify_oauth_browser=");
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/);
    expect(vi.mocked(completeShopifyOAuth)).toHaveBeenCalledWith(
      expect.any(URLSearchParams),
      expect.objectContaining({ browserBindingSecret: BINDING })
    );
  });
});

describe("shopify uninstall trigger time", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = "client-id";
    process.env.SHOPIFY_CLIENT_SECRET = SECRET;
    process.env.SHOPIFY_APP_URL = "https://app.example.com";
    vi.mocked(revokeActiveShopifyConnectionsForShop).mockReset();
    vi.mocked(revokeActiveShopifyConnectionsForShop).mockResolvedValue(1);
  });

  function request(headers: Record<string, string>, body: string) {
    return new NextRequest("https://app.example.com/api/shopify/webhooks/uninstalled", {
      method: "POST",
      headers,
      body,
    });
  }

  it("revokes when the trigger is at or after connect time and stays idempotent", async () => {
    const body = JSON.stringify({ myshopify_domain: "my-shop.myshopify.com" });
    const headers = {
      "x-shopify-hmac-sha256": signedBody(body),
      "x-shopify-topic": "app/uninstalled",
      "x-shopify-shop-domain": "my-shop.myshopify.com",
      "x-shopify-triggered-at": "2026-09-24T13:00:00.000Z",
    };
    const first = await uninstallPost(request(headers, body));
    expect(first.status).toBe(200);
    expect(revokeActiveShopifyConnectionsForShop).toHaveBeenCalledWith(
      expect.anything(),
      "my-shop.myshopify.com",
      new Date("2026-09-24T13:00:00.000Z")
    );
    vi.mocked(revokeActiveShopifyConnectionsForShop).mockResolvedValue(0);
    const second = await uninstallPost(request(headers, body));
    expect(second.status).toBe(200);
  });

  it("does not revoke when the trigger header is missing or malformed", async () => {
    const body = JSON.stringify({ myshopify_domain: "my-shop.myshopify.com" });
    const base = {
      "x-shopify-hmac-sha256": signedBody(body),
      "x-shopify-topic": "app/uninstalled",
      "x-shopify-shop-domain": "my-shop.myshopify.com",
    };
    expect((await uninstallPost(request(base, body))).status).toBe(400);
    expect(
      (await uninstallPost(request({ ...base, "x-shopify-triggered-at": "not-a-date" }, body))).status
    ).toBe(400);
    expect(revokeActiveShopifyConnectionsForShop).not.toHaveBeenCalled();
  });

  it("rejects a bad hmac before trusting the payload", async () => {
    const body = JSON.stringify({ myshopify_domain: "my-shop.myshopify.com" });
    const response = await uninstallPost(
      request(
        {
          "x-shopify-hmac-sha256": "aaaa",
          "x-shopify-topic": "app/uninstalled",
          "x-shopify-shop-domain": "my-shop.myshopify.com",
          "x-shopify-triggered-at": "2026-09-24T13:00:00.000Z",
        },
        body
      )
    );
    expect(response.status).toBe(401);
    expect(revokeActiveShopifyConnectionsForShop).not.toHaveBeenCalled();
  });
});
