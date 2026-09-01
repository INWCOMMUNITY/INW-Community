import { describe, expect, it } from "vitest";
import {
  wixWebhookIsInventoryEvent,
  wixWebhookIsProductDeleted,
  wixWebhookTriggersFullReconcile,
} from "./webhook";

describe("wixWebhookIsProductDeleted", () => {
  it("matches Wix catalog product-deleted events", () => {
    expect(wixWebhookIsProductDeleted("wix.stores.catalog.v3.product_deleted")).toBe(true);
    expect(wixWebhookIsProductDeleted("ProductDeleted")).toBe(true);
    expect(wixWebhookIsProductDeleted("wix.stores.v1.product_deleted")).toBe(true);
  });

  it("does not treat inventory or create events as deletes", () => {
    expect(wixWebhookIsProductDeleted("wix.stores.catalog.v3.inventory_updated")).toBe(false);
    expect(wixWebhookIsProductDeleted("wix.stores.catalog.v3.product_created")).toBe(false);
    expect(wixWebhookIsProductDeleted(null)).toBe(false);
  });
});

describe("wixWebhookTriggersFullReconcile", () => {
  it("runs a full reconcile for product deletes", () => {
    expect(wixWebhookTriggersFullReconcile("wix.stores.catalog.v3.product_deleted")).toBe(true);
    expect(wixWebhookIsInventoryEvent("wix.stores.catalog.v3.product_deleted")).toBe(false);
  });
});
