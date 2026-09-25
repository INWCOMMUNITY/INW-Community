import { describe, expect, it } from "vitest";
import { classifyShopifyListingHealth } from "./listing-health";

const baseListing = {
  desiredProductContentVersion: 1,
  appliedProductContentVersion: 1,
  desiredProductFingerprint: "p1",
  appliedProductFingerprint: "p1",
  productContentConflict: false,
};

const baseVariant = {
  desiredVariantContentVersion: 1,
  appliedVariantContentVersion: 1,
  desiredVariantFingerprint: "v1",
  appliedVariantFingerprint: "v1",
  variantContentConflict: false,
  inventoryInitState: "INITIALIZED" as const,
  inventoryDesiredVersion: 1,
  inventoryAppliedVersion: 1,
  inventoryDesiredAvailable: 10,
  inventoryAppliedAvailable: 10,
  inventoryDriftState: "NONE" as const,
};

const healthyRemote = {
  productExists: true,
  productStatus: "DRAFT",
  variantCount: 1,
  mappedVariantPresent: true,
  inventoryItemMatches: true,
  inventoryTracked: true,
  inventoryLevelExists: true,
  remoteAvailable: 10,
  remoteProductFingerprint: "p1",
  remoteVariantFingerprint: "v1",
};

describe("classifyShopifyListingHealth", () => {
  it("healthy physical DRAFT → READY_TO_PUBLISH", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: baseVariant,
      hasCausalSaleConflict: false,
      remote: healthyRemote,
    });
    expect(health.readiness).toBe("READY_TO_PUBLISH");
    expect(health.issueCode).toBeNull();
    expect(health.blockContentOutbound).toBe(false);
    expect(health.blockInventoryOutbound).toBe(false);
  });

  it("healthy MTO with NOT_APPLICABLE inventory → READY_TO_PUBLISH", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: {
        ...baseVariant,
        inventoryInitState: "NOT_APPLICABLE",
        inventoryDesiredVersion: 0,
        inventoryAppliedVersion: 0,
        inventoryDesiredAvailable: null,
        inventoryAppliedAvailable: null,
      },
      hasCausalSaleConflict: false,
      remote: { ...healthyRemote, remoteAvailable: null, inventoryLevelExists: false },
    });
    expect(health.readiness).toBe("READY_TO_PUBLISH");
  });

  it("content conflict pauses content only", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: { ...baseListing, productContentConflict: true },
      variantMap: baseVariant,
      hasCausalSaleConflict: false,
      remote: healthyRemote,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("CONTENT_CONFLICT");
    expect(health.contentHealth).toBe("PAUSED");
    expect(health.blockContentOutbound).toBe(true);
    expect(health.blockInventoryOutbound).toBe(false);
  });

  it("inventory remote drift pauses inventory only and never forces overwrite", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: { ...baseVariant, inventoryDriftState: "REMOTE_DRIFT" },
      hasCausalSaleConflict: false,
      remote: { ...healthyRemote, remoteAvailable: 8 },
    });
    expect(health.issueCode).toBe("INVENTORY_REMOTE_DRIFT");
    expect(health.inventoryHealth).toBe("PAUSED");
    expect(health.blockInventoryOutbound).toBe(true);
    expect(health.blockContentOutbound).toBe(false);
  });

  it("missing remote product pauses listing without recreate semantics", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: baseVariant,
      hasCausalSaleConflict: false,
      remote: { ...healthyRemote, productExists: false },
    });
    expect(health.issueCode).toBe("REMOTE_PRODUCT_MISSING");
    expect(health.blockContentOutbound).toBe(true);
    expect(health.blockInventoryOutbound).toBe(true);
  });

  it("multi-variant structural drift pauses content", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: baseVariant,
      hasCausalSaleConflict: false,
      remote: { ...healthyRemote, variantCount: 2 },
    });
    expect(health.issueCode).toBe("STRUCTURAL_MULTI_VARIANT");
    expect(health.contentHealth).toBe("PAUSED");
  });

  it("sale-fact causal conflict pauses inventory readiness", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: baseVariant,
      hasCausalSaleConflict: true,
      remote: healthyRemote,
    });
    expect(health.issueCode).toBe("SALE_FACT_CAUSAL_CONFLICT");
    expect(health.inventoryHealth).toBe("PAUSED");
  });

  it("pending inventory init is SYNCING not ACTION_REQUIRED", () => {
    const health = classifyShopifyListingHealth({
      connectionStatus: "ACTIVE",
      primaryLocationId: "gid://shopify/Location/1",
      listing: baseListing,
      variantMap: { ...baseVariant, inventoryInitState: "PENDING", inventoryAppliedVersion: 0 },
      hasCausalSaleConflict: false,
      remote: healthyRemote,
    });
    expect(health.readiness).toBe("SYNCING");
    expect(health.issueCode).toBeNull();
  });
});
