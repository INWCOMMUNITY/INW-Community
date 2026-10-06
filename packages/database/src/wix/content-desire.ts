import type { Prisma, PrismaClient, WixListingLink } from "@prisma/client";
import { enqueueWixSyncJob, wixUpdateListingContentDedupeKey, WixSyncJobConflictError } from "./jobs";

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

function normalizeWixPhotoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return photos
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
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
      desiredProductFingerprint: input.productFingerprint,
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

  const fingerprint = JSON.stringify({
    title: input.after.title,
    description: input.after.description ?? null,
    priceCents: input.after.priceCents,
    sku: input.after.sku ?? null,
    photos: afterPhotos ?? normalizeWixPhotoUrls(input.after.photos),
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
