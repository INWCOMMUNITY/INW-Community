import type { Prisma, PrismaClient, WixListingLink } from "@prisma/client";
import { enqueueWixSyncJob, wixUpdateListingContentDedupeKey, WixSyncJobConflictError } from "./jobs";
import {
  normalizeWixPhotoUrls,
  wixProductContentFingerprint,
  wixTopologyFingerprint,
  wixVariantContentFingerprint,
} from "./content-fingerprint";

export type WixContentDb = PrismaClient | Prisma.TransactionClient;

export type WixListingContentSnapshot = {
  title: string;
  description: string | null;
  priceCents: number;
  sku: string | null;
  /** Optional — when omitted, photos are treated as unchanged. */
  photos?: string[] | null;
};

export type RecordWixMappedListingContentDesireResult =
  | {
      status: "SKIPPED";
      reason: "UNMAPPED" | "CONNECTION_INACTIVE" | "NO_CONTENT_CHANGE";
    }
  | {
      status: "RECORDED";
      connectionId: string;
      listingLinkId: string;
      desiredVersion: number;
      jobEnqueued: boolean;
    };

export interface RecordWixListingContentDesireResult {
  link: WixListingLink;
  desiredVersion: number;
  jobEnqueued: boolean;
}

function clampFingerprint(value: string | null): string | null {
  if (value == null) return null;
  // Column is VarChar(64). Prefer caller-supplied hashes; never store raw JSON.
  return value.length <= 64 ? value : wixProductContentFingerprint({
    title: value,
    description: null,
    photos: [],
    priceCents: 0,
  });
}

/**
 * Record that we want to push content updates to a Wix listing.
 * Increments the desired version to signal outbound sync is needed.
 */
export async function recordWixListingContentDesire(
  db: WixContentDb,
  input: {
    listingLinkId: string;
    productFingerprint: string | null;
    triggeredBy: string;
  }
): Promise<RecordWixListingContentDesireResult> {
  const link = await db.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
  });

  if (!link) {
    throw new Error(`Wix listing link not found: ${input.listingLinkId}`);
  }

  // Increment desired version
  const newVersion = link.desiredProductContentVersion + 1;

  const updated = await db.wixListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      desiredProductContentVersion: newVersion,
      desiredProductFingerprint: clampFingerprint(input.productFingerprint),
    },
  });

  return {
    link: updated,
    desiredVersion: newVersion,
    jobEnqueued: false, // Caller handles job enqueue
  };
}

/**
 * After a canonical StoreItem content edit, bump desired versions and enqueue
 * UPDATE_LISTING_CONTENT when a current mapping exists.
 * Must run inside the same DB transaction as the canonical write.
 * No Wix network calls.
 */
export async function recordWixMappedListingContentDesire(
  db: WixContentDb,
  input: {
    memberId: string;
    storeItemId: string;
    before: WixListingContentSnapshot;
    after: WixListingContentSnapshot;
  }
): Promise<RecordWixMappedListingContentDesireResult> {
  const beforePhotos =
    input.before.photos !== undefined ? normalizeWixPhotoUrls(input.before.photos) : null;
  const afterPhotos =
    input.after.photos !== undefined ? normalizeWixPhotoUrls(input.after.photos) : null;
  const photosChanged =
    beforePhotos != null &&
    afterPhotos != null &&
    JSON.stringify(beforePhotos) !== JSON.stringify(afterPhotos);

  const contentChanged =
    input.before.title !== input.after.title ||
    (input.before.description ?? null) !== (input.after.description ?? null) ||
    input.before.priceCents !== input.after.priceCents ||
    (input.before.sku ?? null) !== (input.after.sku ?? null) ||
    photosChanged;

  if (!contentChanged) {
    return { status: "SKIPPED", reason: "NO_CONTENT_CHANGE" };
  }

  const connection = await db.wixConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const link = await db.wixListingLink.findFirst({
    where: {
      wixConnectionId: connection.id,
      storeItemId: input.storeItemId,
    },
  });
  if (!link || link.readiness === "CONNECTION_REQUIRED") {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  const fingerprint = wixProductContentFingerprint({
    title: input.after.title,
    description: input.after.description ?? null,
    photos: afterPhotos ?? normalizeWixPhotoUrls(input.after.photos),
    priceCents: input.after.priceCents,
  });

  const bumped = await recordWixListingContentDesire(db, {
    listingLinkId: link.id,
    productFingerprint: fingerprint,
    triggeredBy: "STORE_ITEM_EDIT",
  });

  const ensured = await ensureWixUpdateListingContentJob(db, {
    listingLinkId: link.id,
    wixConnectionId: connection.id,
  });

  return {
    status: "RECORDED",
    connectionId: connection.id,
    listingLinkId: link.id,
    desiredVersion: bumped.desiredVersion,
    jobEnqueued: ensured.enqueued,
  };
}

/**
 * After seller add/remove/replace of variant identity on a mapped Wix listing,
 * enqueue reconcile so product options are pushed. This does not bump content desire.
 */
export async function recordWixListingVariantTopologyDesire(
  db: WixContentDb,
  input: { memberId: string; storeItemId: string }
): Promise<RecordWixMappedListingContentDesireResult> {
  const connection = await db.wixConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const link = await db.wixListingLink.findFirst({
    where: {
      wixConnectionId: connection.id,
      storeItemId: input.storeItemId,
    },
  });
  if (!link || link.readiness === "CONNECTION_REQUIRED") {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  const activeVariants = await db.storeVariant.findMany({
    where: { storeItemId: input.storeItemId, memberId: input.memberId, status: "ACTIVE" },
    select: { options: true },
  });
  const fingerprint = wixTopologyFingerprint(activeVariants);
  if (fingerprint !== link.topologyAppliedFingerprint) {
    await db.wixListingLink.update({
      where: { id: link.id },
      data: { topologyDesiredFingerprint: fingerprint },
    });
  }

  // Options are not listing content. Bumping the content desire made a Wix option edit
  // look like "INW and Wix both changed this listing."
  try {
    await enqueueWixSyncJob(db, {
      wixConnectionId: connection.id,
      kind: "RECONCILE_LISTING",
      dedupeKey: `RECONCILE_LISTING:${link.id}:topo:p${link.desiredProductContentVersion}`,
      payload: {
        listingLinkId: link.id,
        storeItemId: input.storeItemId,
        pushTopology: true,
      },
      nextAttemptAt: new Date(),
    });
  } catch (error) {
    if (!(error instanceof WixSyncJobConflictError)) throw error;
  }

  return {
    status: "RECORDED",
    connectionId: connection.id,
    listingLinkId: link.id,
    desiredVersion: link.desiredProductContentVersion,
    jobEnqueued: true,
  };
}

/**
 * After StoreVariant price/SKU rows change, bump desire on every mapped variant
 * whose fingerprint differs and enqueue UPDATE_LISTING_CONTENT so Wix gets the new prices.
 */
export async function recordWixDirtyMappedVariantContentDesires(
  db: WixContentDb,
  input: { memberId: string; storeItemId: string }
): Promise<{ status: "SKIPPED" | "RECORDED"; dirtyCount: number }> {
  const connection = await db.wixConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) return { status: "SKIPPED", dirtyCount: 0 };

  const listing = await db.wixListingLink.findFirst({
    where: {
      wixConnectionId: connection.id,
      storeItemId: input.storeItemId,
    },
  });
  if (!listing || listing.readiness === "CONNECTION_REQUIRED") {
    return { status: "SKIPPED", dirtyCount: 0 };
  }

  const variantMaps = await db.wixVariantMap.findMany({
    where: { wixListingLinkId: listing.id, wixConnectionId: connection.id },
  });
  if (variantMaps.length < 1) return { status: "SKIPPED", dirtyCount: 0 };

  const storeVariants = await db.storeVariant.findMany({
    where: { id: { in: variantMaps.map((map) => map.storeVariantId) } },
    select: { id: true, priceCents: true, sku: true },
  });
  const byId = new Map(storeVariants.map((variant) => [variant.id, variant]));
  const desiredAt = new Date();
  let dirtyCount = 0;

  for (const map of variantMaps) {
    const storeVariant = byId.get(map.storeVariantId);
    if (!storeVariant) continue;
    const fingerprint = wixVariantContentFingerprint({
      priceCents: storeVariant.priceCents,
      sku: storeVariant.sku,
    });
    if (
      fingerprint === map.desiredVariantFingerprint &&
      map.desiredVariantContentVersion > map.appliedVariantContentVersion
    ) {
      dirtyCount += 1;
      continue;
    }
    if (
      fingerprint === map.appliedVariantFingerprint &&
      map.desiredVariantContentVersion <= map.appliedVariantContentVersion
    ) {
      continue;
    }

    const nextVersion = map.desiredVariantContentVersion + 1;
    await db.wixVariantMap.update({
      where: { id: map.id },
      data: {
        desiredVariantContentVersion: nextVersion,
        desiredVariantFingerprint: fingerprint,
        variantDesiredAt: desiredAt,
      },
    });
    dirtyCount += 1;
  }

  if (dirtyCount > 0) {
    await ensureWixUpdateListingContentJob(db, {
      listingLinkId: listing.id,
      wixConnectionId: connection.id,
    });
    return { status: "RECORDED", dirtyCount };
  }

  return { status: "SKIPPED", dirtyCount: 0 };
}

/**
 * Ensure an UPDATE_LISTING_CONTENT job exists for this link.
 * Uses enqueue rules so SUCCEEDED jobs can be re-queued after a new desire.
 */
export async function ensureWixUpdateListingContentJob(
  db: WixContentDb,
  input: {
    listingLinkId: string;
    wixConnectionId: string;
  }
): Promise<{ enqueued: boolean }> {
  const dedupeKey = wixUpdateListingContentDedupeKey(input.listingLinkId);

  try {
    await enqueueWixSyncJob(db, {
      wixConnectionId: input.wixConnectionId,
      kind: "UPDATE_LISTING_CONTENT",
      dedupeKey,
      payload: { listingLinkId: input.listingLinkId },
      nextAttemptAt: new Date(),
    });
    return { enqueued: true };
  } catch (error) {
    if (error instanceof WixSyncJobConflictError) {
      return { enqueued: false };
    }
    throw error;
  }
}

/**
 * Mark content as successfully applied to Wix.
 */
export async function markWixProductContentApplied(
  db: WixContentDb,
  input: {
    listingLinkId: string;
    appliedVersion: number;
    appliedFingerprint: string | null;
  }
): Promise<void> {
  await db.wixListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      appliedProductContentVersion: input.appliedVersion,
      appliedProductFingerprint: input.appliedFingerprint,
      productContentAppliedAt: new Date(),
      contentHealth: "HEALTHY",
    },
  });
}

/**
 * Mark variant content as applied.
 */
export async function markWixVariantContentApplied(
  db: WixContentDb,
  input: {
    variantMapId: string;
    appliedVersion: number;
    appliedFingerprint: string | null;
  }
): Promise<void> {
  await db.wixVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      appliedVariantContentVersion: input.appliedVersion,
      appliedVariantFingerprint: input.appliedFingerprint,
      variantContentAppliedAt: new Date(),
    },
  });
}

/**
 * Set a content conflict flag on a listing link.
 */
export async function setWixProductContentConflict(
  db: WixContentDb,
  input: {
    listingLinkId: string;
    conflictCode: string;
    conflictMessage: string;
  }
): Promise<void> {
  await db.wixListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      contentHealth: "DEGRADED",
      productContentConflict: true,
      issueCode: input.conflictCode,
      issueMessage: input.conflictMessage,
    },
  });
}

/**
 * Clear a content conflict.
 */
export async function clearWixProductContentConflict(
  db: WixContentDb,
  input: {
    listingLinkId: string;
  }
): Promise<void> {
  await db.wixListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      contentHealth: "HEALTHY",
      issueCode: null,
      issueMessage: null,
    },
  });
}
