import { describe, expect, it } from "vitest";
import {
  isInwShopifyWebhookAddress,
  shopifyWebhookIdsToDelete,
  shopifyWebhookTopicsToCreate,
} from "./webhooks-subscribe";

const INW = "https://www.inwcommunity.com/api/channels/shopify/webhook";
const OTHER = "https://other-app.example/webhooks/shopify";

describe("shopifyWebhookTopicsToCreate", () => {
  it("does not treat another app's same-topic webhook as ours", () => {
    const missing = shopifyWebhookTopicsToCreate(
      [{ id: 1, topic: "products/update", address: OTHER }],
      INW,
      ["products/update", "app/uninstalled"]
    );
    expect(missing).toEqual(["products/update", "app/uninstalled"]);
  });

  it("skips topics already registered at our callback", () => {
    const missing = shopifyWebhookTopicsToCreate(
      [
        { id: 1, topic: "products/update", address: `${INW}/` },
        { id: 2, topic: "app/uninstalled", address: OTHER },
      ],
      INW,
      ["products/update", "app/uninstalled"]
    );
    expect(missing).toEqual(["app/uninstalled"]);
  });
});

describe("shopifyWebhookIdsToDelete", () => {
  it("deletes only webhooks at INW callback addresses", () => {
    const ids = shopifyWebhookIdsToDelete(
      [
        { id: 11, topic: "products/update", address: INW },
        { id: 12, topic: "orders/paid", address: OTHER },
        { id: 13, topic: "app/uninstalled", address: "https://preview.inwcommunity.com/api/channels/shopify/webhook" },
      ],
      [INW, "https://preview.inwcommunity.com/api/channels/shopify/webhook"]
    );
    expect(ids).toEqual([11, 13]);
  });

  it("matches trailing-slash variants of our address", () => {
    expect(isInwShopifyWebhookAddress(`${INW}/`, [INW])).toBe(true);
    expect(isInwShopifyWebhookAddress(OTHER, [INW])).toBe(false);
  });
});
