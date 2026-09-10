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
  const pushedAt = new Date("2026-09-10T02:26:13.756Z");
  const nowMs = new Date("2026-09-10T02:26:18.000Z").getTime();

  it("does not pull a title mismatch in the push echo window", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: pushedAt,
        inwUpdatedAt: pushedAt,
        remoteUpdatedAt: pushedAt,
        titleOrPriceDiffers: true,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: false,
        nowMs,
      })
    ).toBe(false);
  });

  it("does not pull a delayed Shopify webhook after INW already has a newer eBay/Etsy edit", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: new Date("2026-09-10T02:00:00.000Z"),
        inwUpdatedAt: new Date("2026-09-10T02:30:26.884Z"),
        remoteUpdatedAt: new Date("2026-09-10T02:10:00.000Z"),
        titleOrPriceDiffers: true,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: false,
        nowMs: new Date("2026-09-10T02:31:00.000Z").getTime(),
      })
    ).toBe(false);
  });

  it("does not pull when Shopify updated_at is older than INW", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: new Date("2026-09-10T01:00:00.000Z"),
        inwUpdatedAt: new Date("2026-09-10T02:30:00.000Z"),
        remoteUpdatedAt: new Date("2026-09-10T02:00:00.000Z"),
        titleOrPriceDiffers: true,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: false,
        nowMs: new Date("2026-09-10T02:35:00.000Z").getTime(),
      })
    ).toBe(false);
  });

  it("pulls a Shopify Admin title edit when updated_at is newer than INW", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: new Date("2026-09-10T02:00:00.000Z"),
        inwUpdatedAt: new Date("2026-09-10T02:00:00.000Z"),
        remoteUpdatedAt: new Date("2026-09-10T02:30:00.000Z"),
        titleOrPriceDiffers: true,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: false,
        nowMs: new Date("2026-09-10T02:31:00.000Z").getTime(),
      })
    ).toBe(true);
  });

  it("ignores photo-only echoes of our own push", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: pushedAt,
        inwUpdatedAt: pushedAt,
        remoteUpdatedAt: pushedAt,
        titleOrPriceDiffers: false,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: true,
        nowMs,
      })
    ).toBe(false);
  });

  it("pulls photo-only Shopify edits after the echo window", () => {
    expect(
      shopifyWebhookShouldPull({
        lastPushedAt: new Date("2026-09-10T02:00:00.000Z"),
        inwUpdatedAt: new Date("2026-09-10T02:00:00.000Z"),
        remoteUpdatedAt: new Date("2026-09-10T02:30:00.000Z"),
        titleOrPriceDiffers: false,
        descriptionDiffers: false,
        qtyDiffers: false,
        photosDiffer: true,
        nowMs: new Date("2026-09-10T02:31:00.000Z").getTime(),
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
