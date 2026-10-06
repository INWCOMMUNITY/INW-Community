import type { Prisma, PrismaClient, WixListingLink } from "@prisma/client";
import { wixUpdateListingContentDedupeKey, WixSyncJobConflictError } from "./jobs";

export type WixContentDb = PrismaClient | Prisma.TransactionClient;

export interface RecordWixListingContentDesireResult {
  link: WixListingLink;
  desiredVersion: number;
  jobEnqueued: boolean;
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
 * Ensure an UPDATE_LISTING_CONTENT job exists for this link.
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
    await db.wixSyncJob.create({
      data: {
        wixConnectionId: input.wixConnectionId,
        kind: "UPDATE_LISTING_CONTENT",
        dedupeKey,
        payload: { listingLinkId: input.listingLinkId },
        state: "PENDING",
        maxAttempts: 8,
        nextAttemptAt: new Date(),
      },
    });
    return { enqueued: true };
  } catch (error) {
    // Dedupe key conflict means job already exists
    if ((error as { code?: string }).code === "P2002") {
      return { enqueued: false };
    }
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
