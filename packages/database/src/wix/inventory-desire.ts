import type { Prisma, PrismaClient } from "@prisma/client";
import { trackedAvailable } from "../commerce-foundation-inventory";
import { enqueueWixSyncJob, wixProjectInventoryDedupeKey } from "./jobs";

export type WixInventoryDesireDb = PrismaClient | Prisma.TransactionClient;

export type CaptureWixInventoryProjectionDesireResult = {
  variantMapId: string;
  desiredAvailable: number;
  desiredVersion: number;
  jobEnqueued: boolean;
};

/**
 * Capture an inventory projection desire for a Wix variant map.
 * Increments desiredVersion and enqueues a PROJECT_INVENTORY job.
 */
export async function captureWixInventoryProjectionDesire(
  db: WixInventoryDesireDb,
  input: {
    variantMapId: string;
    wixConnectionId: string;
    listingLinkId: string;
    desiredAvailable: number;
  }
): Promise<CaptureWixInventoryProjectionDesireResult> {
  const now = new Date();

  // Update the variant map with new desire
  const updated = await db.wixVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      inventoryDesiredAvailable: input.desiredAvailable,
      inventoryDesiredVersion: { increment: 1 },
      inventoryDesiredAt: now,
    },
  });

  // Enqueue job for the listing link
  let jobEnqueued = false;
  try {
    await enqueueWixSyncJob(db as PrismaClient, {
      wixConnectionId: input.wixConnectionId,
      kind: "PROJECT_INVENTORY",
      dedupeKey: wixProjectInventoryDedupeKey(input.listingLinkId),
      payload: { listingLinkId: input.listingLinkId },
    });
    jobEnqueued = true;
  } catch {
    // Job may already exist
  }

  return {
    variantMapId: updated.id,
    desiredAvailable: input.desiredAvailable,
    desiredVersion: updated.inventoryDesiredVersion,
    jobEnqueued,
  };
}

/**
 * After a foundation sellable-availability change, record a Wix projection desire.
 * Skips Wix-originated events so an inbound Wix edit is not pushed back to Wix.
 */
export async function captureWixInventoryProjectionDesireAfterChange(
  db: WixInventoryDesireDb,
  input: { memberId: string; storeVariantId: string }
): Promise<
  | { status: "SKIPPED"; reason: "UNMAPPED" | "CONNECTION_INACTIVE" | "NO_CHANGE" | "INVALID_STATE" | "WIX_ORIGIN" }
  | { status: "RECORDED"; desiredVersion: number }
> {
  const latest = await db.inventoryEvent.findFirst({
    where: { variantId: input.storeVariantId, memberId: input.memberId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { sourceSystem: true },
  });
  if (latest?.sourceSystem === "wix") {
    return { status: "SKIPPED", reason: "WIX_ORIGIN" };
  }

  const connection = await db.wixConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const variantMap = await db.wixVariantMap.findFirst({
    where: { wixConnectionId: connection.id, storeVariantId: input.storeVariantId },
  });
  if (!variantMap) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  const state = await db.inventoryState.findUnique({
    where: { variantId: input.storeVariantId },
  });
  if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }

  let sellable: number;
  try {
    sellable = trackedAvailable(state.onHand, state.reserved);
  } catch {
    return { status: "SKIPPED", reason: "INVALID_STATE" };
  }
  if (
    variantMap.inventoryDesiredAvailable === sellable &&
    (variantMap.inventoryDesiredVersion > variantMap.inventoryAppliedVersion ||
      variantMap.inventoryAppliedAvailable === sellable)
  ) {
    return { status: "SKIPPED", reason: "NO_CHANGE" };
  }

  const recorded = await captureWixInventoryProjectionDesire(db, {
    variantMapId: variantMap.id,
    wixConnectionId: connection.id,
    listingLinkId: variantMap.wixListingLinkId,
    desiredAvailable: sellable,
  });
  return { status: "RECORDED", desiredVersion: recorded.desiredVersion };
}

/**
 * Mark an inventory projection as applied for a variant map.
 */
export async function markWixInventoryProjectionApplied(
  db: WixInventoryDesireDb,
  input: {
    variantMapId: string;
    appliedAvailable: number;
    appliedVersion: number;
  }
): Promise<void> {
  await db.wixVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      inventoryAppliedAvailable: input.appliedAvailable,
      inventoryAppliedVersion: input.appliedVersion,
      inventoryAppliedAt: new Date(),
    },
  });
}

/**
 * Ensure a PROJECT_INVENTORY job exists for a listing link.
 */
export async function ensureWixProjectInventoryJob(
  db: PrismaClient,
  input: { wixConnectionId: string; listingLinkId: string }
): Promise<{ jobId: string }> {
  const job = await enqueueWixSyncJob(db, {
    wixConnectionId: input.wixConnectionId,
    kind: "PROJECT_INVENTORY",
    dedupeKey: wixProjectInventoryDedupeKey(input.listingLinkId),
    payload: { listingLinkId: input.listingLinkId },
  });
  return { jobId: job.id };
}

/**
 * Check if any variant maps for a listing have unprojected inventory desires.
 */
export async function hasUnprojectedWixInventoryDesires(
  db: WixInventoryDesireDb,
  listingLinkId: string
): Promise<boolean> {
  const count = await db.wixVariantMap.count({
    where: {
      wixListingLinkId: listingLinkId,
      OR: [
        {
          inventoryDesiredVersion: { gt: db.wixVariantMap.fields.inventoryAppliedVersion },
        },
        {
          inventoryDesiredAvailable: { not: null },
          inventoryAppliedAvailable: null,
        },
      ],
    },
  });
  return count > 0;
}

/**
 * Get all variant maps with unprojected inventory for a listing.
 */
export async function getUnprojectedWixVariantMaps(
  db: WixInventoryDesireDb,
  listingLinkId: string
): Promise<
  Array<{
    id: string;
    storeVariantId: string;
    wixVariantId: string;
    desiredAvailable: number | null;
    appliedAvailable: number | null;
    desiredVersion: number;
    appliedVersion: number;
  }>
> {
  const maps = await db.wixVariantMap.findMany({
    where: { wixListingLinkId: listingLinkId },
    select: {
      id: true,
      storeVariantId: true,
      wixVariantId: true,
      inventoryDesiredAvailable: true,
      inventoryAppliedAvailable: true,
      inventoryDesiredVersion: true,
      inventoryAppliedVersion: true,
    },
  });

  return maps
    .filter(
      (m) =>
        m.inventoryDesiredVersion > m.inventoryAppliedVersion ||
        (m.inventoryDesiredAvailable !== null && m.inventoryAppliedAvailable === null)
    )
    .map((m) => ({
      id: m.id,
      storeVariantId: m.storeVariantId,
      wixVariantId: m.wixVariantId,
      desiredAvailable: m.inventoryDesiredAvailable,
      appliedAvailable: m.inventoryAppliedAvailable,
      desiredVersion: m.inventoryDesiredVersion,
      appliedVersion: m.inventoryAppliedVersion,
    }));
}
