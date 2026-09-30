import { describe, expect, it } from "vitest";
import {
  classifyShopifyInventoryProjectionAction,
  shopifyInventoryActivateIdempotencyKey,
  shopifyInventorySetIdempotencyKey,
  shopifyProjectInventoryDedupeKey,
} from "./inventory-projection";

describe("classifyShopifyInventoryProjectionAction", () => {
  it("sale-before-S7: remote 8 with desired 10 and applied base 10 → REMOTE_DRIFT (no mutate)", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "INITIALIZED",
        desiredAvailable: 10,
        appliedAvailable: 10,
        remoteAvailable: 8,
        levelExists: true,
        tracked: true,
      })
    ).toEqual({
      action: "REMOTE_DRIFT",
      code: "REMOTE_DRIFT",
      desired: 10,
      appliedBase: 10,
      remote: 8,
    });
  });

  it("S7 catch-up: remote already equals desired → ALREADY_CONVERGED", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "INITIALIZED",
        desiredAvailable: 8,
        appliedAvailable: 10,
        remoteAvailable: 8,
        levelExists: true,
        tracked: true,
      })
    ).toEqual({ action: "ALREADY_CONVERGED", quantity: 8 });
  });

  it("local sale: remote equals applied base → SAFE_CAS", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "INITIALIZED",
        desiredAvailable: 9,
        appliedAvailable: 10,
        remoteAvailable: 10,
        levelExists: true,
        tracked: true,
      })
    ).toEqual({ action: "SAFE_CAS", quantity: 9, changeFromQuantity: 10 });
  });

  it("reservation release with unexpected remote does not restore", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "INITIALIZED",
        desiredAvailable: 10,
        appliedAvailable: 9,
        remoteAvailable: 8,
        levelExists: true,
        tracked: true,
      }).action
    ).toBe("REMOTE_DRIFT");
  });

  it("one-time init activate when level missing", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "PENDING",
        desiredAvailable: 10,
        appliedAvailable: null,
        remoteAvailable: null,
        levelExists: false,
        tracked: true,
      })
    ).toEqual({ action: "INIT_ACTIVATE", quantity: 10 });
  });

  it("one-time init set when level exists (even if remote differs)", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "PENDING",
        desiredAvailable: 10,
        appliedAvailable: null,
        remoteAvailable: 0,
        levelExists: true,
        tracked: true,
      })
    ).toEqual({ action: "INIT_SET", quantity: 10, changeFromQuantity: 0 });
  });

  it("MTO is not applicable", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "NOT_APPLICABLE",
        desiredAvailable: null,
        appliedAvailable: null,
        remoteAvailable: 5,
        levelExists: true,
        tracked: true,
      }).action
    ).toBe("NOT_APPLICABLE");
  });

  it("rejects negative desired without clamping", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "INITIALIZED",
        desiredAvailable: -1,
        appliedAvailable: 0,
        remoteAvailable: 0,
        levelExists: true,
        tracked: true,
      }).action
    ).toBe("INVALID_TARGET");
  });

  it("enable tracked during pending init", () => {
    expect(
      classifyShopifyInventoryProjectionAction({
        initState: "PENDING",
        desiredAvailable: 3,
        appliedAvailable: null,
        remoteAvailable: null,
        levelExists: false,
        tracked: false,
      }).action
    ).toBe("ENABLE_TRACKED");
  });
});

describe("shopify inventory projection keys", () => {
  it("dedupe and idempotency keys are deterministic and intent-specific", () => {
    expect(
      shopifyProjectInventoryDedupeKey({
        connectionId: "c1",
        storeVariantId: "sv1",
        inventoryDesiredVersion: 2,
      })
    ).toBe("PROJECT_INVENTORY:c1:sv1:v2");

    const setA = shopifyInventorySetIdempotencyKey({
      connectionId: "c1",
      storeVariantId: "sv1",
      inventoryDesiredVersion: 2,
      changeFromQuantity: 10,
      quantity: 8,
    });
    const setB = shopifyInventorySetIdempotencyKey({
      connectionId: "c1",
      storeVariantId: "sv1",
      inventoryDesiredVersion: 2,
      changeFromQuantity: 9,
      quantity: 8,
    });
    expect(setA).not.toBe(setB);
    expect(
      shopifyInventoryActivateIdempotencyKey({
        connectionId: "c1",
        storeVariantId: "sv1",
        inventoryDesiredVersion: 1,
        quantity: 10,
      })
    ).toContain("inw-inv-act");
  });
});
