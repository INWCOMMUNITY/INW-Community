import { describe, expect, it, vi } from "vitest";
import { ensureShopifyProductsUpdateWebhook } from "./client";

const ACCESS = "shpat_test_access_token_value";
const INBOX = "https://www.inwcommunity.com/api/shopify/webhooks/inbox";

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
        // Production 2026-07 shape: canonical `uri`, no legacy endpoint.callbackUrl.
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

  it("still fails closed when an existing PRODUCTS_UPDATE uri is incompatible", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          webhookSubscriptions: {
            nodes: [
              {
                id: "gid://shopify/WebhookSubscription/1",
                topic: "PRODUCTS_UPDATE",
                uri: "https://evil.example.com/hook",
                endpoint: null,
              },
            ],
          },
        },
      })
    );
    await expect(
      ensureShopifyProductsUpdateWebhook({
        shopDomain: "jpuhtv-df.myshopify.com",
        accessToken: ACCESS,
        callbackUrl: INBOX,
        fetchImpl,
      })
    ).rejects.toThrow(/incompatible/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
