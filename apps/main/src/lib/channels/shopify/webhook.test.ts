import { describe, expect, it } from "vitest";
import { shouldApplyShopifyInboundWebhook } from "./webhook";

describe("shouldApplyShopifyInboundWebhook", () => {
  it("applies product and inventory topics only while Shopify is active", () => {
    expect(shouldApplyShopifyInboundWebhook("active", "products/update")).toBe(true);
    expect(shouldApplyShopifyInboundWebhook("active", "inventory_levels/update")).toBe(true);
    expect(shouldApplyShopifyInboundWebhook("active", "orders/paid")).toBe(true);
    expect(shouldApplyShopifyInboundWebhook("error", "products/update")).toBe(false);
    expect(shouldApplyShopifyInboundWebhook("error", "inventory_levels/update")).toBe(false);
    expect(shouldApplyShopifyInboundWebhook("disconnected", "products/update")).toBe(false);
  });

  it("still processes uninstall on a paused connection", () => {
    expect(shouldApplyShopifyInboundWebhook("error", "app/uninstalled")).toBe(true);
    expect(shouldApplyShopifyInboundWebhook("active", "app/uninstalled")).toBe(true);
    expect(shouldApplyShopifyInboundWebhook("disconnected", "app/uninstalled")).toBe(false);
  });
});
