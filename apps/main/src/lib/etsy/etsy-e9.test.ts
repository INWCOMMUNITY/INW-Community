import { describe, expect, it } from "vitest";
import { classifyEtsyListingHealth } from "database";

describe("classifyEtsyListingHealth", () => {
  const baseListing = {
    desiredProductContentVersion: 1,
    appliedProductContentVersion: 1,
    productContentConflict: false,
    contentHealth: "HEALTHY" as const,
    inventoryHealth: "HEALTHY" as const,
  };
  const baseVariant = {
    desiredVariantContentVersion: 1,
    appliedVariantContentVersion: 1,
    variantContentConflict: false,
    inventoryDesiredVersion: 1,
    inventoryAppliedVersion: 1,
    inventoryDesiredAvailable: 2,
    inventoryAppliedAvailable: 2,
  };

  it("marks ready when caught up", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: { ...baseListing, remoteListingState: "active" },
      variantMaps: [baseVariant],
      hasCausalSaleConflict: false,
    });
    expect(health.readiness).toBe("READY_TO_PUBLISH");
    expect(health.issueCode).toBeNull();
  });

  it("does not mark draft listings ready even when sync is caught up", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: { ...baseListing, remoteListingState: "draft" },
      variantMaps: [baseVariant],
      hasCausalSaleConflict: false,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("DRAFT_NOT_ACTIVE");
  });

  it("marks action required on content conflict", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: { ...baseListing, productContentConflict: true, remoteListingState: "active" },
      variantMaps: [baseVariant],
      hasCausalSaleConflict: false,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("CONTENT_CONFLICT");
  });

  it("marks syncing when inventory desire is pending", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: { ...baseListing, remoteListingState: "active" },
      variantMaps: [{ ...baseVariant, inventoryDesiredVersion: 3, inventoryAppliedVersion: 2 }],
      hasCausalSaleConflict: false,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("INVENTORY_SYNC_PENDING");
  });
});
