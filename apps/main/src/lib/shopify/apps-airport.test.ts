import { describe, expect, it } from "vitest";
import {
  APPS_AIRPORT_MARKETPLACES,
  APPS_AIRPORT_PATH,
  APPS_AIRPORT_SHOPIFY_IMPORT_PATH,
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_SYNC_PATH,
  classifyShopifyConnectionUi,
  resolveShopifySyncProgress,
  shopifyAdminProductUrl,
  shopifyConnectionStatusLabel,
  shopifyListingSellerNote,
  shopifyListingUiStatus,
  shopifyReadinessLabel,
  formatShopifyObservedQuantity,
} from "./apps-airport";

describe("Sync Airport routes", () => {
  it("exposes first-class seller navigation paths under /seller-hub/apps", () => {
    expect(APPS_AIRPORT_PATH).toBe("/seller-hub/apps");
    expect(APPS_AIRPORT_SHOPIFY_PATH).toBe("/seller-hub/apps/shopify");
    expect(APPS_AIRPORT_SHOPIFY_SYNC_PATH).toBe("/seller-hub/apps/shopify/sync");
    expect(APPS_AIRPORT_SHOPIFY_LISTINGS_PATH).toBe("/seller-hub/apps/shopify/listings");
    expect(APPS_AIRPORT_SHOPIFY_IMPORT_PATH).toBe("/seller-hub/apps/shopify/import");
    expect(APPS_AIRPORT_SHOPIFY_SETTINGS_PATH).toBe("/seller-hub/apps/shopify/settings");
  });

  it("lists Shopify, Etsy, and Wix as available marketplaces (no eBay)", () => {
    expect(APPS_AIRPORT_MARKETPLACES.map((m) => m.id)).toEqual(["shopify", "etsy", "wix"]);
    for (const id of ["shopify", "etsy", "wix"] as const) {
      expect(APPS_AIRPORT_MARKETPLACES.find((m) => m.id === id)?.availability).toBe("available");
    }
    expect(APPS_AIRPORT_MARKETPLACES.find((m) => m.id === "shopify")?.href).toBe(
      APPS_AIRPORT_SHOPIFY_PATH
    );
    expect(APPS_AIRPORT_MARKETPLACES.some((m) => (m as { id: string }).id === "ebay")).toBe(false);
  });
});

describe("Shopify connection UI status", () => {
  it("marks disconnected when no active connection", () => {
    expect(classifyShopifyConnectionUi(null)).toBe("disconnected");
    expect(classifyShopifyConnectionUi({ status: "DISCONNECTED" })).toBe("disconnected");
    expect(shopifyConnectionStatusLabel("disconnected")).toBe("Not connected");
  });

  it("marks needs attention when location is missing", () => {
    expect(
      classifyShopifyConnectionUi({
        status: "ACTIVE",
        inventoryReady: false,
        locationSelectionRequired: true,
      })
    ).toBe("needs_attention");
  });

  it("marks connected when active and inventory ready", () => {
    expect(
      classifyShopifyConnectionUi({
        status: "ACTIVE",
        inventoryReady: true,
        locationSelectionRequired: false,
      })
    ).toBe("connected");
  });
});

describe("Shopify sync progress and labels", () => {
  it("does not treat enqueue alone as published", () => {
    expect(resolveShopifySyncProgress({ enqueueStatus: "queued", listing: null })).toBe(
      "creating_product"
    );
    expect(
      resolveShopifySyncProgress({
        enqueueStatus: "queued",
        listing: { readiness: "SYNCING", inventoryInitState: "PENDING" },
      })
    ).toBe("inventory_initializing");
    expect(
      resolveShopifySyncProgress({
        enqueueStatus: "queued",
        listing: {
          readiness: "SYNCING",
          inventoryInitState: "INITIALIZED",
          remoteProductStatus: "DRAFT",
        },
      })
    ).toBe("publishing");
    expect(
      resolveShopifySyncProgress({
        enqueueStatus: "queued",
        listing: { readiness: "READY_TO_PUBLISH", inventoryInitState: "INITIALIZED" },
      })
    ).toBe("published");
  });

  it("treats in-progress inventory as syncing and explains a paused link", () => {
    expect(
      shopifyListingUiStatus({
        readiness: "SYNCING",
        inventoryHealth: "DEGRADED",
        contentHealth: "HEALTHY",
      })
    ).toBe("Syncing");
    expect(
      shopifyListingSellerNote({
        status: "Needs attention",
        issueCode: "REMOTE_VARIANT_MISSING",
        issueMessage: "The mapped Shopify variant can no longer be found.",
      })
    ).toMatch(/Reconnect listing/);
    expect(
      shopifyListingSellerNote({
        status: "Syncing",
        remoteProductStatus: "DRAFT",
      })
    ).toMatch(/still a draft/);
    expect(
      shopifyListingSellerNote({
        status: "Needs attention",
      })
    ).toMatch(/Reconnect listing/);
  });

  it("preserves backend readiness truth in labels", () => {
    expect(shopifyReadinessLabel("READY_TO_PUBLISH")).toBe("Live");
    expect(shopifyReadinessLabel("ACTION_REQUIRED")).toBe("Needs attention");
  });

  it("builds a safe Shopify Admin product URL", () => {
    expect(
      shopifyAdminProductUrl("demo.myshopify.com", "gid://shopify/Product/123")
    ).toBe("https://demo.myshopify.com/admin/products/123");
    expect(shopifyAdminProductUrl("custom.example.com", "gid://shopify/Product/123")).toBeNull();
  });

  it("never presents desired quantity as verified Shopify stock", () => {
    expect(
      formatShopifyObservedQuantity({
        inventoryAppliedAvailable: null,
        inventoryDesiredAvailable: 3,
      })
    ).toBe("— (desired 3)");
    expect(
      formatShopifyObservedQuantity({
        inventoryAppliedAvailable: 3,
        inventoryDesiredAvailable: 3,
      })
    ).toBe("3");
    expect(
      formatShopifyObservedQuantity({
        inventoryAppliedAvailable: null,
        inventoryDesiredAvailable: null,
      })
    ).toBe("—");
  });
});
