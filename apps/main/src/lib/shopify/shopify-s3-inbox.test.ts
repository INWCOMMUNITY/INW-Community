import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingest = vi.fn();

vi.mock("database", () => ({
  prisma: {},
  ingestShopifyWebhookEvidence: (...args: unknown[]) => ingest(...args),
}));

vi.mock("@/lib/shopify/config", () => ({
  readShopifyAppConfig: () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    appUrl: "https://app.example.com",
    redirectUri: "https://app.example.com/api/shopify/oauth/callback",
    uninstallWebhookUri: "https://app.example.com/api/shopify/webhooks/uninstalled",
    scopes: [],
    apiVersion: "2026-07",
  }),
}));

import { POST as inboxPost } from "@/app/api/shopify/webhooks/inbox/route";

function signed(body: string) {
  return createHmac("sha256", "client-secret").update(body, "utf8").digest("base64");
}

describe("shopify webhook inbox route", () => {
  beforeEach(() => {
    ingest.mockReset();
    ingest.mockResolvedValue({
      status: "CREATED",
      evidence: { id: "ev-1" },
      jobId: "job-1",
    });
  });

  it("rejects invalid hmac before ingest and accepts a valid delivery", async () => {
    const body = JSON.stringify({ myshopify_domain: "my-shop.myshopify.com" });
    const bad = await inboxPost(
      new NextRequest("https://app.example.com/api/shopify/webhooks/inbox", {
        method: "POST",
        headers: {
          "x-shopify-hmac-sha256": "nope",
          "x-shopify-topic": "products/update",
          "x-shopify-shop-domain": "my-shop.myshopify.com",
          "x-shopify-webhook-id": "wh-1",
          "x-shopify-triggered-at": "2026-09-24T13:00:00.000Z",
        },
        body,
      })
    );
    expect(bad.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();

    const good = await inboxPost(
      new NextRequest("https://app.example.com/api/shopify/webhooks/inbox", {
        method: "POST",
        headers: {
          "x-shopify-hmac-sha256": signed(body),
          "x-shopify-topic": "products/update",
          "x-shopify-shop-domain": "my-shop.myshopify.com",
          "x-shopify-webhook-id": "wh-1",
          "x-shopify-event-id": "evt-1",
          "x-shopify-triggered-at": "2026-09-24T13:00:00.000Z",
          "x-shopify-api-version": "2026-07",
        },
        body,
      })
    );
    expect(good.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][1]).toMatchObject({
      shopDomain: "my-shop.myshopify.com",
      topic: "products/update",
      webhookId: "wh-1",
      eventId: "evt-1",
      rawBody: body,
    });
  });
});
