import type { Prisma, PrismaClient, ShopifySyncJob, ShopifyVariantMap } from "@prisma/client";
import { trackedAvailable } from "../commerce-foundation-inventory";
import { enqueueShopifySyncJob } from "./jobs";
import { shopifyProjectInventoryDedupeKey } from "./inventory-projection";

export type ShopifyInventoryDesireDb = PrismaClient | Prisma.TransactionClient;

export type CaptureShopifyInventoryProjectionDesireResult =
  | {
      status: "SKIPPED";
      reason:
        | "UNMAPPED"
        | "CONNECTION_INACTIVE"
        | "NO_CHANGE"
        | "INVALID_STATE"
        | "NOT_APPLICABLE";
    }
  | {
      status: "RECORDED";
      connectionId: string;
      storeVariantId: string;
      inventoryDesiredVersion: number;
      inventoryDesiredAvailable: number | null;
      jobId: string | null;
      initState: ShopifyVariantMap["inventoryInitState"];
    };

function inventoryDesireLockKey(variantMapId: string): string {
  return `shopify-inventory-desire:${variantMapId}`;
}

/** Idempotent enqueue for an existing desired inventory version (no version bump). */
export async function ensureShopifyProjectInventoryJob(
  db: ShopifyInventoryDesireDb,
  input: {
    connectionId: string;
    storeItemId: string;
    storeVariantId: string;
    inventoryDesiredVersion: number;
  }
): Promise<ShopifySyncJob> {
  return enqueueShopifySyncJob(db, {
    shopifyConnectionId: input.connectionId,
    kind: "PROJECT_INVENTORY",
    dedupeKey: shopifyProjectInventoryDedupeKey({
      connectionId: input.connectionId,
      storeVariantId: input.storeVariantId,
      inventoryDesiredVersion: input.inventoryDesiredVersion,
    }),
    payload: {
      storeItemId: input.storeItemId,
      storeVariantId: input.storeVariantId,
      inventoryDesiredVersion: input.inventoryDesiredVersion,
    },
  });
}

/**
 * Seed initial inventory desire + job inside the S4 mapping transaction.
 * PHYSICAL → PENDING desire v1 + PROJECT_INVENTORY job.
 * MADE_TO_ORDER → NOT_APPLICABLE, no finite quantity, no job.
 */
export async function seedShopifyInventoryProjectionOnMapping(
  db: ShopifyInventoryDesireDb,
  input: {
    connectionId: string;
    memberId: string;
    storeItemId: string;
    storeVariantId: string;
    variantMapId: string;
  }
): Promise<CaptureShopifyInventoryProjectionDesireResult> {
  const state = await db.inventoryState.findUnique({
    where: { variantId: input.storeVariantId },
  });
  if (!state) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  if (state.mode === "MADE_TO_ORDER") {
    await db.shopifyVariantMap.update({
      where: { id: input.variantMapId },
      data: {
        inventoryInitState: "NOT_APPLICABLE",
        inventoryDesiredVersion: 0,
        inventoryDesiredAvailable: null,
        inventoryAppliedVersion: 0,
        inventoryAppliedAvailable: null,
        inventoryDriftState: "NONE",
        inventoryDriftCode: null,
        inventoryDriftMessage: null,
        inventoryDriftDetectedAt: null,
        inventoryDesiredAt: new Date(),
      },
    });
    return {
      status: "RECORDED",
      connectionId: input.connectionId,
      storeVariantId: input.storeVariantId,
      inventoryDesiredVersion: 0,
      inventoryDesiredAvailable: null,
      jobId: null,
      initState: "NOT_APPLICABLE",
    };
  }

  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  let sellable: number;
  try {
    sellable = trackedAvailable(state.onHand, state.reserved);
  } catch {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }
  if (!Number.isInteger(sellable) || sellable < 0) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  const desiredAt = new Date();
  await db.shopifyVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      inventoryInitState: "PENDING",
      inventoryDesiredVersion: 1,
      inventoryDesiredAvailable: sellable,
      inventoryAppliedVersion: 0,
      inventoryAppliedAvailable: null,
      inventoryDriftState: "NONE",
      inventoryDriftCode: null,
      inventoryDriftMessage: null,
      inventoryDriftDetectedAt: null,
      inventoryDesiredAt: desiredAt,
      inventoryPendingMutationKind: null,
      inventoryPendingIdempotencyKey: null,
      inventoryPendingChangeFrom: null,
      inventoryPendingTargetQty: null,
      inventoryPendingFingerprint: null,
    },
  });

  const job = await ensureShopifyProjectInventoryJob(db, {
    connectionId: input.connectionId,
    storeItemId: input.storeItemId,
    storeVariantId: input.storeVariantId,
    inventoryDesiredVersion: 1,
  });

  return {
    status: "RECORDED",
    connectionId: input.connectionId,
    storeVariantId: input.storeVariantId,
    inventoryDesiredVersion: 1,
    inventoryDesiredAvailable: sellable,
    jobId: job.id,
    initState: "PENDING",
  };
}

/**
 * After a Foundation sellable-availability change for a mapped variant:
 * bump inventory desired version/quantity and enqueue PROJECT_INVENTORY.
 * Must run inside the same DB transaction as the canonical inventory write.
 * No Shopify network calls.
 */
export async function captureShopifyInventoryProjectionDesire(
  db: ShopifyInventoryDesireDb,
  input: { memberId: string; storeVariantId: string }
): Promise<CaptureShopifyInventoryProjectionDesireResult> {
  const connection = await db.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, status: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const variantMap = await db.shopifyVariantMap.findUnique({
    where: {
      shopifyConnectionId_storeVariantId: {
        shopifyConnectionId: connection.id,
        storeVariantId: input.storeVariantId,
      },
    },
  });
  if (!variantMap) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inventoryDesireLockKey(variantMap.id)}))`;
  const locked = await db.shopifyVariantMap.findUniqueOrThrow({ where: { id: variantMap.id } });

  const state = await db.inventoryState.findUnique({
    where: { variantId: input.storeVariantId },
  });
  if (!state) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  if (state.mode === "MADE_TO_ORDER") {
    if (locked.inventoryInitState !== "NOT_APPLICABLE") {
      await db.shopifyVariantMap.update({
        where: { id: locked.id },
        data: {
          inventoryInitState: "NOT_APPLICABLE",
          inventoryDesiredAvailable: null,
          inventoryDriftState: "NONE",
          inventoryDriftCode: null,
          inventoryDriftMessage: null,
          inventoryDriftDetectedAt: null,
          inventoryDesiredAt: new Date(),
          inventoryPendingMutationKind: null,
          inventoryPendingIdempotencyKey: null,
          inventoryPendingChangeFrom: null,
          inventoryPendingTargetQty: null,
          inventoryPendingFingerprint: null,
        },
      });
    }
    return { status: "SKIPPED", reason: "NOT_APPLICABLE" };
  }

  if (state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  let sellable: number;
  try {
    sellable = trackedAvailable(state.onHand, state.reserved);
  } catch {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }
  if (!Number.isInteger(sellable) || sellable < 0) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  // No-op when sellable equals already-recorded desire (e.g. reservation convert).
  if (
    locked.inventoryDesiredAvailable === sellable &&
    locked.inventoryDesiredVersion > 0 &&
    locked.inventoryInitState !== "FAILED"
  ) {
    return { status: "SKIPPED", reason: "NO_CHANGE" };
  }

  const nextVersion = locked.inventoryDesiredVersion + 1;
  const desiredAt = new Date();
  await db.shopifyVariantMap.update({
    where: { id: locked.id },
    data: {
      inventoryDesiredVersion: nextVersion,
      inventoryDesiredAvailable: sellable,
      inventoryDesiredAt: desiredAt,
      // New local canonical desire supersedes prior drift termination for a fresh attempt.
      inventoryDriftState: "NONE",
      inventoryDriftCode: null,
      inventoryDriftMessage: null,
      inventoryDriftDetectedAt: null,
      inventoryPendingMutationKind: null,
      inventoryPendingIdempotencyKey: null,
      inventoryPendingChangeFrom: null,
      inventoryPendingTargetQty: null,
      inventoryPendingFingerprint: null,
      // Keep init state; PENDING stays PENDING until worker initializes.
      inventoryInitState:
        locked.inventoryInitState === "NOT_APPLICABLE" ? "PENDING" : locked.inventoryInitState,
    },
  });

  const job = await ensureShopifyProjectInventoryJob(db, {
    connectionId: connection.id,
    storeItemId: locked.storeItemId,
    storeVariantId: locked.storeVariantId,
    inventoryDesiredVersion: nextVersion,
  });

  return {
    status: "RECORDED",
    connectionId: connection.id,
    storeVariantId: locked.storeVariantId,
    inventoryDesiredVersion: nextVersion,
    inventoryDesiredAvailable: sellable,
    jobId: job.id,
    initState:
      locked.inventoryInitState === "NOT_APPLICABLE" ? "PENDING" : locked.inventoryInitState,
  };
}

export async function markShopifyInventoryProjectionApplied(
  db: ShopifyInventoryDesireDb,
  input: {
    variantMapId: string;
    desiredVersion: number;
    available: number;
    observedAvailable?: number;
    now?: Date;
  }
): Promise<boolean> {
  const updated = await db.shopifyVariantMap.updateMany({
    where: {
      id: input.variantMapId,
      inventoryAppliedVersion: { lte: input.desiredVersion },
    },
    data: {
      inventoryAppliedVersion: input.desiredVersion,
      inventoryAppliedAvailable: input.available,
      inventoryLastObservedAvailable: input.observedAvailable ?? input.available,
      inventoryInitState: "INITIALIZED",
      inventoryAppliedAt: input.now ?? new Date(),
      inventoryDriftState: "NONE",
      inventoryDriftCode: null,
      inventoryDriftMessage: null,
      inventoryDriftDetectedAt: null,
      inventoryPendingMutationKind: null,
      inventoryPendingIdempotencyKey: null,
      inventoryPendingChangeFrom: null,
      inventoryPendingTargetQty: null,
      inventoryPendingFingerprint: null,
    },
  });
  return updated.count === 1;
}

export async function markShopifyInventoryProjectionRemoteDrift(
  db: ShopifyInventoryDesireDb,
  input: {
    variantMapId: string;
    remoteAvailable: number;
    code?: string;
    message?: string;
    now?: Date;
  }
): Promise<void> {
  await db.shopifyVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      inventoryLastObservedAvailable: input.remoteAvailable >= 0 ? input.remoteAvailable : null,
      inventoryDriftState: "REMOTE_DRIFT",
      inventoryDriftCode: (input.code ?? "REMOTE_DRIFT").slice(0, 64),
      inventoryDriftMessage: (input.message ?? "Unexplained remote Shopify available quantity").slice(
        0,
        2000
      ),
      inventoryDriftDetectedAt: input.now ?? new Date(),
      inventoryPendingMutationKind: null,
      inventoryPendingIdempotencyKey: null,
      inventoryPendingChangeFrom: null,
      inventoryPendingTargetQty: null,
      inventoryPendingFingerprint: null,
    },
  });
}

export async function setShopifyInventoryProjectionPendingMutation(
  db: ShopifyInventoryDesireDb,
  input: {
    variantMapId: string;
    kind: string;
    idempotencyKey: string;
    fingerprint: string;
    changeFromQuantity?: number | null;
    targetQty?: number | null;
  }
): Promise<void> {
  await db.shopifyVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      inventoryPendingMutationKind: input.kind.slice(0, 64),
      inventoryPendingIdempotencyKey: input.idempotencyKey.slice(0, 200),
      inventoryPendingFingerprint: input.fingerprint.slice(0, 128),
      inventoryPendingChangeFrom: input.changeFromQuantity ?? null,
      inventoryPendingTargetQty: input.targetQty ?? null,
    },
  });
}

export async function clearShopifyInventoryProjectionPendingMutation(
  db: ShopifyInventoryDesireDb,
  variantMapId: string
): Promise<void> {
  await db.shopifyVariantMap.update({
    where: { id: variantMapId },
    data: {
      inventoryPendingMutationKind: null,
      inventoryPendingIdempotencyKey: null,
      inventoryPendingChangeFrom: null,
      inventoryPendingTargetQty: null,
      inventoryPendingFingerprint: null,
    },
  });
}

export type { ShopifySyncJob };
