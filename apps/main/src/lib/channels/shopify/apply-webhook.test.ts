import { describe, expect, it } from "vitest";
import { parseShopifyWebhookProduct, shopifyWebhookShouldPull } from "./apply-webhook";
import { shopifyWebhookCallbackUrl } from "./webhooks-subscribe";

describe("parseShopifyWebhookProduct", () => {
  it("reads the REST webhook product at the root", () => {
    const parsed = parseShopifyWebhookProduct({
      id: 11,
      title: "Hat",
      updated_at: "2026-09-08T12:00:00Z",
    });
    expect(parsed?.id).toBe(11);
    expect(parsed?.title).toBe("Hat");
  });

  it("unwraps { product }", () => {
    const parsed = parseShopifyWebhookProduct({ product: { id: 22, title: "Mug" } });
    expect(parsed?.id).toBe(22);
  });
});

describe("shopifyWebhookShouldPull", () => {
  const recentPush = new Date(Date.now() - 5_000);

  it("applies title or price edits immediately even right after an INW push", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: recentPush,
        titleOrPriceDiffers: true,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: false,
      })
    ).toBe(true);
  });

  it("ignores photo-only echoes of our own push", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: recentPush,
        titleOrPriceDiffers: false,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: true,
      })
    ).toBe(false);
  });

  it("pulls photo-only Shopify edits after the echo window", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: new Date(Date.now() - 60_000),
        titleOrPriceDiffers: false,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: true,
      })
    ).toBe(true);
  });
});

describe("shopifyWebhookCallbackUrl", () => {
  it("rejects localhost", () => {
    const prev = process.env.SHOPIFY_WEBHOOK_URL;
    process.env.SHOPIFY_WEBHOOK_URL = "http://localhost:3000/api/channels/shopify/webhook";
    expect(shopifyWebhookCallbackUrl()).toBeNull();
    process.env.SHOPIFY_WEBHOOK_URL = prev;
  });

  it("accepts a public https URL", () => {
    const prev = process.env.SHOPIFY_WEBHOOK_URL;
    process.env.SHOPIFY_WEBHOOK_URL = "https://www.inwcommunity.com/api/channels/shopify/webhook";
    expect(shopifyWebhookCallbackUrl()).toBe(
      "https://www.inwcommunity.com/api/channels/shopify/webhook"
    );
    process.env.SHOPIFY_WEBHOOK_URL = prev;
  });
});
