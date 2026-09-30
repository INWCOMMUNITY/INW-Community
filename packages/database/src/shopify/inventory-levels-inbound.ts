import type { Prisma, PrismaClient } from "@prisma/client";
import {
  applyTrackedMarketplaceQuantityEdit,
  MARKETPLACE_QUANTITY_EDIT_SCOPE,
} from "../commerce-foundation-inventory";
import {
  classifyShopifyDirectInventoryEdit,
  shouldPauseInventoryForDirectShopifyEdit,
} from "./inventory-direct-edit";
import {
  markShopifyInventoryProjectionApplied,
  markShopifyInventoryProjectionRemoteDrift,
} from "./inventory-desire";

export type ShopifyInventoryLevelsDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyInventoryLevelObservation = {
  inventoryItemId: string;
  locationId: string;
  available: number;
  /** Durable evidence identity for idempotency. */
  evidenceId: string;
  /** Optional inventory level GID when present. */
  inventoryLevelId?: string | null;
};

export type ApplyShopifyInventoryLevelResult =
  | { status: "APPLIED_EDIT"; created: boolean; onHandAfter: number }
  | { status: "ECHO_CONFIRMED" }
  | { status: "SALE_EXPLAINED" }
  | { status: "WAITING_ORDER"; code: "WAITING_ORDER_CAUSALITY" }
  /** @deprecated Prefer SALE_EXPLAINED or WAITING_ORDER; retained for callers. */
  | { status: "SALE_PENDING_OR_EXPLAINED" }
  | { status: "PAUSED_UNCERTAIN"; code: string }
  | { status: "IGNORED"; reason: string };

/**
 * Apply a primary-location inventory observation after causal sale reconciliation.
 * Never LWW into Foundation without proven marketplace quantity edit identity.
 * Caller must run inside a transaction when composing with other writes.
 */
export async function applyShopifyInventoryLevelObservation(
  db: ShopifyInventoryLevelsDb,
  input: {
    connectionId: string;
    memberId: string;
    primaryLocationId: string;
    observation: ShopifyInventoryLevelObservation;
    /** True when unprocessed ORDERS_PAID evidence may still explain the delta. */
    hasPendingOrderEvidence: boolean;
    /** Optional explained sale delta already applied (negative for sale). */
    explainedSaleDelta?: number | null;
  }
): Promise<ApplyShopifyInventoryLevelResult> {
  if (input.observation.locationId !== input.primaryLocationId) {
    return { status: "IGNORED", reason: "NON_PRIMARY_LOCATION" };
  }

  const variantMap = await db.shopifyVariantMap.findFirst({
    where: {
      shopifyConnectionId: input.connectionId,
      shopifyInventoryItemId: input.observation.inventoryItemId,
    },
  });
  if (!variantMap) {
    return { status: "IGNORED", reason: "UNMAPPED_INVENTORY_ITEM" };
  }

  const remote = input.observation.available;
  if (!Number.isInteger(remote) || remote < 0) {
    await markShopifyInventoryProjectionRemoteDrift(db, {
      variantMapId: variantMap.id,
      remoteAvailable: remote,
      code: "INVALID_REMOTE_AVAILABLE",
      message: "Inventory level available is not a non-negative integer",
    });
    return { status: "PAUSED_UNCERTAIN", code: "INVALID_REMOTE_AVAILABLE" };
  }

  if (
    variantMap.inventoryDesiredAvailable != null &&
    remote === variantMap.inventoryDesiredAvailable
  ) {
    if (
      variantMap.inventoryDesiredVersion > 0 &&
      variantMap.inventoryAppliedVersion < variantMap.inventoryDesiredVersion
    ) {
      await markShopifyInventoryProjectionApplied(db, {
        variantMapId: variantMap.id,
        desiredVersion: variantMap.inventoryDesiredVersion,
        available: remote,
        observedAvailable: remote,
      });
    }
    return { status: "ECHO_CONFIRMED" };
  }
  if (
    variantMap.inventoryPendingTargetQty != null &&
    remote === variantMap.inventoryPendingTargetQty
  ) {
    await markShopifyInventoryProjectionApplied(db, {
      variantMapId: variantMap.id,
      desiredVersion: Math.max(variantMap.inventoryDesiredVersion, 1),
      available: remote,
      observedAvailable: remote,
    });
    return { status: "ECHO_CONFIRMED" };
  }

  if (input.hasPendingOrderEvidence) {
    await markShopifyInventoryProjectionRemoteDrift(db, {
      variantMapId: variantMap.id,
      remoteAvailable: remote,
      code: "WAITING_ORDER_CAUSALITY",
      message: "Inventory delta observed while order evidence may still explain it",
    });
    // Do not finalize evidence — caller should RETRY after ORDERS_PAID processes.
    return { status: "WAITING_ORDER", code: "WAITING_ORDER_CAUSALITY" };
  }

  let explainedSaleDelta = input.explainedSaleDelta ?? null;
  if (explainedSaleDelta == null && variantMap.inventoryAppliedAvailable != null) {
    const since = variantMap.inventoryAppliedAt ?? undefined;
    const saleFacts = await db.shopifyOrderLineSaleFact.findMany({
      where: {
        shopifyConnectionId: input.connectionId,
        storeVariantId: variantMap.storeVariantId,
        applyState: "APPLIED",
        ...(since ? { appliedAt: { gt: since } } : {}),
      },
      select: { appliedQuantity: true, paidQuantity: true },
    });
    if (saleFacts.length > 0) {
      const sold = saleFacts.reduce(
        (sum, row) => sum + (row.appliedQuantity > 0 ? row.appliedQuantity : row.paidQuantity),
        0
      );
      if (sold > 0) explainedSaleDelta = -sold;
    }
  }

  const cls = classifyShopifyDirectInventoryEdit({
    remoteAvailable: remote,
    desiredAvailable: variantMap.inventoryDesiredAvailable,
    appliedAvailable: variantMap.inventoryAppliedAvailable,
    explainedDelta: explainedSaleDelta,
  });

  if (cls === "MATCHES_DESIRED" || cls === "MATCHES_APPLIED_BASE") {
    return { status: "ECHO_CONFIRMED" };
  }
  if (cls === "EXPLAINED_BY_SALE") {
    // Sale already applied in Foundation; confirm observed remote without MQE.
    await markShopifyInventoryProjectionApplied(db, {
      variantMapId: variantMap.id,
      desiredVersion: Math.max(variantMap.inventoryDesiredVersion, 1),
      available: remote,
      observedAvailable: remote,
    });
    return { status: "SALE_EXPLAINED" };
  }
  if (cls !== "UNEXPLAINED_REMOTE_EDIT" && !shouldPauseInventoryForDirectShopifyEdit(cls)) {
    return { status: "IGNORED", reason: cls };
  }

  const state = await db.inventoryState.findUnique({
    where: { variantId: variantMap.storeVariantId },
    select: { onHand: true, reserved: true, mode: true },
  });
  if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null) {
    await markShopifyInventoryProjectionRemoteDrift(db, {
      variantMapId: variantMap.id,
      remoteAvailable: remote,
      code: "FOUNDATION_STATE_MISSING",
      message: "Cannot apply marketplace quantity edit without TRACKED foundation state",
    });
    return { status: "PAUSED_UNCERTAIN", code: "FOUNDATION_STATE_MISSING" };
  }

  // Shopify available ≈ onHand - reserved; target onHand = available + reserved.
  const reserved = state.reserved ?? 0;
  const targetOnHand = remote + reserved;
  const sourceFactId =
    input.observation.inventoryLevelId?.trim() ||
    `invlvl:${input.observation.inventoryItemId}:${input.observation.locationId}:${input.observation.evidenceId}:${remote}`;

  try {
    const applied = await applyTrackedMarketplaceQuantityEdit(db, {
      variantId: variantMap.storeVariantId,
      memberId: input.memberId,
      targetOnHand,
      sourceScope: `${MARKETPLACE_QUANTITY_EDIT_SCOPE}:${input.connectionId}`,
      sourceFactId,
      metadata: {
        shopifyInventoryItemId: input.observation.inventoryItemId,
        locationId: input.observation.locationId,
        observedAvailable: remote,
        evidenceId: input.observation.evidenceId,
      },
    });

    if (applied.status === "SKIPPED") {
      return { status: "ECHO_CONFIRMED" };
    }

    // applyTrackedMarketplaceQuantityEdit → setTrackedOnHand may bump desire + enqueue
    // PROJECT_INVENTORY. Re-read so we never roll inventoryDesiredVersion backward
    // (stale pre-capture version caused DESIRE_VERSION_AHEAD on the new job).
    const mapAfter = await db.shopifyVariantMap.findUniqueOrThrow({
      where: { id: variantMap.id },
    });
    const desireVersion = Math.max(mapAfter.inventoryDesiredVersion, 1);
    await db.shopifyVariantMap.update({
      where: { id: variantMap.id },
      data: {
        inventoryDriftState: "NONE",
        inventoryDriftCode: null,
        inventoryDriftMessage: null,
        inventoryDriftDetectedAt: null,
        inventoryLastObservedAvailable: remote,
        inventoryDesiredAvailable: remote,
        inventoryDesiredVersion: desireVersion,
        inventoryAppliedAvailable: remote,
        inventoryAppliedVersion: desireVersion,
        inventoryAppliedAt: new Date(),
        inventoryPendingMutationKind: null,
        inventoryPendingIdempotencyKey: null,
        inventoryPendingChangeFrom: null,
        inventoryPendingTargetQty: null,
        inventoryPendingFingerprint: null,
      },
    });
    return {
      status: "APPLIED_EDIT",
      created: applied.created,
      onHandAfter: applied.onHandAfter,
    };
  } catch {
    await markShopifyInventoryProjectionRemoteDrift(db, {
      variantMapId: variantMap.id,
      remoteAvailable: remote,
      code: "MARKETPLACE_QTY_EDIT_FAILED",
      message: "Could not prove/apply marketplace quantity edit; inventory paused",
    });
    return { status: "PAUSED_UNCERTAIN", code: "MARKETPLACE_QTY_EDIT_FAILED" };
  }
}

export type { Prisma };
