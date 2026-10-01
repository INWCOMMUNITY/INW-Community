import type { Prisma, PrismaClient, EtsySyncJob } from "@prisma/client";
import { trackedAvailable } from "../commerce-foundation-inventory";
import { enqueueEtsySyncJob } from "./jobs";

export type EtsyInventoryDesireDb = PrismaClient | Prisma.TransactionClient;

export type CaptureEtsyInventoryProjectionDesireResult =
  | {
      status: "SKIPPED";
      reason: "UNMAPPED" | "CONNECTION_INACTIVE" | "NO_CHANGE" | "INVALID_STATE" | "NOT_APPLICABLE";
    }
  | {
      status: "RECORDED";
      connectionId: string;
      storeVariantId: string;
      inventoryDesiredVersion: number;
      inventoryDesiredAvailable: number | null;
      jobId: string | null;
    };

export function etsyProjectInventoryDedupeKey(input: {
  connectionId: string;
  storeVariantId: string;
  inventoryDesiredVersion: number;
}): string {
  return `PROJECT_INVENTORY:${input.connectionId}:${input.storeVariantId}:v${input.inventoryDesiredVersion}`;
}

function inventoryDesireLockKey(variantMapId: string): string {
  return `etsy-inventory-desire:${variantMapId}`;
}

export async function ensureEtsyProjectInventoryJob(
  db: EtsyInventoryDesireDb,
  input: {
    connectionId: string;
    storeItemId: string;
    storeVariantId: string;
    inventoryDesiredVersion: number;
  }
): Promise<EtsySyncJob> {
  return enqueueEtsySyncJob(db, {
    etsyConnectionId: input.connectionId,
    kind: "PROJECT_INVENTORY",
    dedupeKey: etsyProjectInventoryDedupeKey({
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
 * After a Foundation sellable-availability change for a mapped Etsy variant:
 * bump inventory desired version/quantity and enqueue PROJECT_INVENTORY.
 * No Etsy network calls. Never blocks qty 0 sell-outs.
 */
export async function captureEtsyInventoryProjectionDesire(
  db: EtsyInventoryDesireDb,
  input: { memberId: string; storeVariantId: string }
): Promise<CaptureEtsyInventoryProjectionDesireResult> {
  const connection = await db.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const variantMap = await db.etsyVariantMap.findUnique({
    where: {
      etsyConnectionId_storeVariantId: {
        etsyConnectionId: connection.id,
        storeVariantId: input.storeVariantId,
      },
    },
  });
  if (!variantMap) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inventoryDesireLockKey(variantMap.id)}))`;
  const locked = await db.etsyVariantMap.findUniqueOrThrow({ where: { id: variantMap.id } });

  const state = await db.inventoryState.findUnique({
    where: { variantId: input.storeVariantId },
  });
  if (!state) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  if (state.mode === "MADE_TO_ORDER") {
    if (locked.inventoryDesiredAvailable != null) {
      await db.etsyVariantMap.update({
        where: { id: locked.id },
        data: {
          inventoryDesiredAvailable: null,
          inventoryDesiredAt: new Date(),
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

  if (
    locked.inventoryDesiredAvailable === sellable &&
    locked.inventoryDesiredVersion > locked.inventoryAppliedVersion
  ) {
    const job = await ensureEtsyProjectInventoryJob(db, {
      connectionId: connection.id,
      storeItemId: locked.storeItemId,
      storeVariantId: locked.storeVariantId,
      inventoryDesiredVersion: locked.inventoryDesiredVersion,
    });
    return {
      status: "RECORDED",
      connectionId: connection.id,
      storeVariantId: locked.storeVariantId,
      inventoryDesiredVersion: locked.inventoryDesiredVersion,
      inventoryDesiredAvailable: sellable,
      jobId: job.id,
    };
  }

  if (
    locked.inventoryAppliedAvailable === sellable &&
    locked.inventoryDesiredVersion <= locked.inventoryAppliedVersion &&
    locked.inventoryDesiredAvailable === sellable
  ) {
    return { status: "SKIPPED", reason: "NO_CHANGE" };
  }

  const nextVersion = locked.inventoryDesiredVersion + 1;
  await db.etsyVariantMap.update({
    where: { id: locked.id },
    data: {
      inventoryDesiredVersion: nextVersion,
      inventoryDesiredAvailable: sellable,
      inventoryDesiredAt: new Date(),
    },
  });

  const job = await ensureEtsyProjectInventoryJob(db, {
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
  };
}

export async function markEtsyInventoryProjectionApplied(
  db: EtsyInventoryDesireDb,
  input: {
    variantMapId: string;
    desiredVersion: number;
    available: number;
    now?: Date;
  }
): Promise<void> {
  await db.etsyVariantMap.updateMany({
    where: {
      id: input.variantMapId,
      inventoryAppliedVersion: { lte: input.desiredVersion },
    },
    data: {
      inventoryAppliedVersion: input.desiredVersion,
      inventoryAppliedAvailable: input.available,
      inventoryAppliedAt: input.now ?? new Date(),
    },
  });
}

export type { Prisma };
