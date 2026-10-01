import { describe, expect, it } from "vitest";
import { classifyEtsyListingHealth } from "./listing-health";

const baseListing = {
  desiredProductContentVersion: 1,
  appliedProductContentVersion: 1,
  productContentConflict: false,
  contentHealth: "HEALTHY" as const,
  inventoryHealth: "HEALTHY" as const,
  remoteListingState: "active",
};

const baseMap = {
  desiredVariantContentVersion: 1,
  appliedVariantContentVersion: 1,
  variantContentConflict: false,
  inventoryDesiredVersion: 1,
  inventoryAppliedVersion: 1,
  inventoryDesiredAvailable: 2,
  inventoryAppliedAvailable: 2,
  lastObservedVariantFingerprint: "abc",
  appliedVariantFingerprint: "abc",
  desiredVariantFingerprint: "abc",
};

describe("classifyEtsyListingHealth divergence", () => {
  it("flags TOPOLOGY_DIVERGED when INW/Etsy structure mismatch", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: baseListing,
      variantMaps: [baseMap],
      hasCausalSaleConflict: false,
      topologyDiverged: true,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("TOPOLOGY_DIVERGED");
  });

  it("flags CONTENT_OBSERVATION_DIVERGED when observed price/SKU differs", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: baseListing,
      variantMaps: [baseMap],
      hasCausalSaleConflict: false,
      contentObservationDiverged: true,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("CONTENT_OBSERVATION_DIVERGED");
  });

  it("flags INVENTORY_OBSERVATION_DIVERGED when observed qty differs", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: baseListing,
      variantMaps: [baseMap],
      hasCausalSaleConflict: false,
      inventoryObservationDiverged: true,
    });
    expect(health.readiness).toBe("ACTION_REQUIRED");
    expect(health.issueCode).toBe("INVENTORY_OBSERVATION_DIVERGED");
  });

  it("stays healthy when channels match", () => {
    const health = classifyEtsyListingHealth({
      connectionStatus: "ACTIVE",
      listing: baseListing,
      variantMaps: [baseMap],
      hasCausalSaleConflict: false,
    });
    expect(health.readiness).toBe("READY_TO_PUBLISH");
    expect(health.issueCode).toBeNull();
  });
});
