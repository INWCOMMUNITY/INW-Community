import { describe, expect, it, vi } from "vitest";
import { ensureShopifyProductsUpdateWebhook } from "./client";

const ACCESS = "shpat_test_access_token_value";
const INBOX = "https://www.inwcommunity.com/api/shopify/webhooks/inbox";
const STALE = "https://preview.example.com/api/shopify/webhooks/inbox";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("shopify webhook uri finalization (production regression)", () => {
  it("creates PRODUCTS_UPDATE with uri and accepts uri-only list nodes after create", async () => {
    let lists = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: { uri?: string; callbackUrl?: string };
      };
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
                  uri: INBOX,
                  endpoint: null,
                },
              ],
            },
          },
        });
      }
      expect(body.query).toContain("uri: $uri");
      expect(body.query).not.toMatch(/callbackUrl:\s*\$/);
      expect(body.variables?.uri).toBe(INBOX);
      expect(body.variables?.callbackUrl).toBeUndefined();
      return jsonResponse({
        data: {
          webhookSubscriptionCreate: {
            userErrors: [],
            webhookSubscription: {
              id: "gid://shopify/WebhookSubscription/55",
              topic: "PRODUCTS_UPDATE",
              uri: INBOX,
            },
          },
        },
      });
    });

    const result = await ensureShopifyProductsUpdateWebhook({
      shopDomain: "jpuhtv-df.myshopify.com",
      accessToken: ACCESS,
      callbackUrl: INBOX,
      fetchImpl,
    });
    expect(result).toEqual({
      status: "CREATED",
      subscriptionId: "gid://shopify/WebhookSubscription/55",
    });
  });

  it("retargets same-app PRODUCTS_UPDATE with a stale incompatible uri (attempt 72967071)", async () => {
    let lists = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: { id?: string; uri?: string };
      };
      if (body.query.includes("ShopifyProductsUpdateWebhookSubscriptions")) {
        lists += 1;
        const uri = lists === 1 ? STALE : INBOX;
        return jsonResponse({
          data: {
            webhookSubscriptions: {
              nodes: [
                {
                  id: "gid://shopify/WebhookSubscription/1",
                  topic: "PRODUCTS_UPDATE",
                  uri,
                  endpoint: null,
                },
              ],
            },
          },
        });
      }
      expect(body.query).toContain("webhookSubscriptionUpdate");
      expect(body.variables?.id).toBe("gid://shopify/WebhookSubscription/1");
      expect(body.variables?.uri).toBe(INBOX);
      return jsonResponse({
        data: {
          webhookSubscriptionUpdate: {
            userErrors: [],
            webhookSubscription: {
              id: "gid://shopify/WebhookSubscription/1",
              topic: "PRODUCTS_UPDATE",
              uri: INBOX,
            },
          },
        },
      });
    });

    const result = await ensureShopifyProductsUpdateWebhook({
      shopDomain: "jpuhtv-df.myshopify.com",
      accessToken: ACCESS,
      callbackUrl: INBOX,
      fetchImpl,
    });
    expect(result).toEqual({
      status: "UPDATED",
      subscriptionId: "gid://shopify/WebhookSubscription/1",
    });
    expect(lists).toBe(2);
  });

  it("fails closed when stale PRODUCTS_UPDATE uri update is rejected", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("ShopifyProductsUpdateWebhookSubscriptions")) {
        return jsonResponse({
          data: {
            webhookSubscriptions: {
              nodes: [
                {
                  id: "gid://shopify/WebhookSubscription/1",
                  topic: "PRODUCTS_UPDATE",
                  uri: STALE,
                  endpoint: null,
                },
              ],
            },
          },
        });
      }
      return jsonResponse({
        data: {
          webhookSubscriptionUpdate: {
            userErrors: [{ message: "Address is not allowed" }],
            webhookSubscription: null,
          },
        },
      });
    });

    await expect(
      ensureShopifyProductsUpdateWebhook({
        shopDomain: "jpuhtv-df.myshopify.com",
        accessToken: ACCESS,
        callbackUrl: INBOX,
        fetchImpl,
      })
    ).rejects.toThrow(/PRODUCTS_UPDATE webhook registration failed/i);
  });

  it("accepts create id when post-create list omits destination fields", async () => {
    let lists = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("ShopifyProductsUpdateWebhookSubscriptions")) {
        lists += 1;
        return jsonResponse({ data: { webhookSubscriptions: { nodes: [] } } });
      }
      return jsonResponse({
        data: {
          webhookSubscriptionCreate: {
            userErrors: [],
            webhookSubscription: {
              id: "gid://shopify/WebhookSubscription/77",
              topic: "PRODUCTS_UPDATE",
              uri: INBOX,
            },
          },
        },
      });
    });

    const result = await ensureShopifyProductsUpdateWebhook({
      shopDomain: "jpuhtv-df.myshopify.com",
      accessToken: ACCESS,
      callbackUrl: INBOX,
      fetchImpl,
    });
    expect(result.status).toBe("CREATED");
    expect(result.subscriptionId).toBe("gid://shopify/WebhookSubscription/77");
    expect(lists).toBeGreaterThanOrEqual(2);
  });
});
