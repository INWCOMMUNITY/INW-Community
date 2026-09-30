import type { ShopifyInventoryProjectionInitState } from "@prisma/client";

/**
 * Pure outbound projection decision. Never treats unexplained remote quantity as
 * canonical INW input. Used by the worker and unit tests.
 */
export type ShopifyInventoryProjectionDecision =
  | { action: "NOT_APPLICABLE" }
  | { action: "INVALID_TARGET"; code: string; message: string }
  | { action: "ENABLE_TRACKED" }
  | { action: "INIT_ACTIVATE"; quantity: number }
  | { action: "INIT_SET"; quantity: number; changeFromQuantity: number }
  | { action: "ALREADY_CONVERGED"; quantity: number }
  | { action: "SAFE_CAS"; quantity: number; changeFromQuantity: number }
  | {
      action: "REMOTE_DRIFT";
      code: "REMOTE_DRIFT";
      desired: number;
      appliedBase: number | null;
      remote: number;
    }
  | { action: "MISSING_APPLIED_BASE"; code: string; message: string };

export function classifyShopifyInventoryProjectionAction(input: {
  initState: ShopifyInventoryProjectionInitState;
  desiredAvailable: number | null;
  appliedAvailable: number | null;
  remoteAvailable: number | null;
  /** True when an inventory level exists at the selected location. */
  levelExists: boolean;
  tracked: boolean;
}): ShopifyInventoryProjectionDecision {
  if (input.initState === "NOT_APPLICABLE") {
    return { action: "NOT_APPLICABLE" };
  }

  if (input.desiredAvailable == null || !Number.isInteger(input.desiredAvailable) || input.desiredAvailable < 0) {
    return {
      action: "INVALID_TARGET",
      code: "INVALID_DESIRED_AVAILABLE",
      message: `Desired available must be an integer >= 0; got ${String(input.desiredAvailable)}`,
    };
  }

  const desired = input.desiredAvailable;

  if (input.initState === "PENDING" || input.initState === "FAILED") {
    if (!input.tracked) {
      return { action: "ENABLE_TRACKED" };
    }
    if (!input.levelExists || input.remoteAvailable == null) {
      return { action: "INIT_ACTIVATE", quantity: desired };
    }
    // One-time fresh bootstrap may set canonical even when Shopify default differs.
    return {
      action: "INIT_SET",
      quantity: desired,
      changeFromQuantity: input.remoteAvailable,
    };
  }

  // INITIALIZED — strict remote-drift rules.
  if (input.remoteAvailable == null || !input.levelExists) {
    return {
      action: "REMOTE_DRIFT",
      code: "REMOTE_DRIFT",
      desired,
      appliedBase: input.appliedAvailable,
      remote: -1,
    };
  }

  const remote = input.remoteAvailable;
  if (remote === desired) {
    return { action: "ALREADY_CONVERGED", quantity: desired };
  }

  if (input.appliedAvailable == null) {
    return {
      action: "MISSING_APPLIED_BASE",
      code: "MISSING_APPLIED_BASE",
      message: "Initialized projection is missing applied available baseline",
    };
  }

  const appliedBase = input.appliedAvailable;
  if (remote === appliedBase) {
    return { action: "SAFE_CAS", quantity: desired, changeFromQuantity: remote };
  }

  // REMOTE differs from BOTH desired and applied base — do not mutate.
  return {
    action: "REMOTE_DRIFT",
    code: "REMOTE_DRIFT",
    desired,
    appliedBase,
    remote,
  };
}

export function shopifyProjectInventoryDedupeKey(input: {
  connectionId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
}): string {
  return `PROJECT_INVENTORY:${input.connectionId}:${input.storeVariantId}:v${input.inventoryDesiredVersion}`;
}

export function shopifyInventoryProjectionReferenceUri(input: {
  connectionId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
}): string {
  return `inw://shopify-inventory-projection/${input.connectionId}/${input.storeVariantId}/v${input.inventoryDesiredVersion}`;
}

/** Deterministic provider idempotency key for an exact mutation intent. */
export function shopifyInventorySetIdempotencyKey(input: {
  connectionId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
  changeFromQuantity: number;
  quantity: number;
}): string {
  return [
    "inw-inv-set",
    input.connectionId,
    input.storeVariantId,
    `v${input.inventoryDesiredVersion}`,
    `from${input.changeFromQuantity}`,
    `to${input.quantity}`,
  ].join(":");
}

export function shopifyInventoryActivateIdempotencyKey(input: {
  connectionId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
  quantity: number;
}): string {
  return [
    "inw-inv-act",
    input.connectionId,
    input.storeVariantId,
    `v${input.inventoryDesiredVersion}`,
    `qty${input.quantity}`,
  ].join(":");
}

export function shopifyInventoryTrackedIdempotencyKey(input: {
  connectionId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
}): string {
  return [
    "inw-inv-track",
    input.connectionId,
    input.storeVariantId,
    `v${input.inventoryDesiredVersion}`,
  ].join(":");
}
