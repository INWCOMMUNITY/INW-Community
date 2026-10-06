import type { Prisma, PrismaClient, WixCapabilityHealth, WixListingReadiness } from "@prisma/client";
import { enqueueWixSyncJob, wixReconcileListingDedupeKey } from "./jobs";

export type WixHealthDb = PrismaClient | Prisma.TransactionClient;

export type WixListingHealthSnapshot = {
  readiness: WixListingReadiness;
  contentHealth: WixCapabilityHealth;
  inventoryHealth: WixCapabilityHealth;
  issueCode: string | null;
  issueMessage: string | null;
  issueSeverity: string | null;
};

export type ClassifyWixListingHealthInput = {
  connectionStatus: "ACTIVE" | "DISCONNECTED";
  remoteProductVisible: boolean | null;
  hasPhotos: boolean;
  priceCents: number;
  contentDesiredVersion: number;
  contentAppliedVersion: number;
  inventoryDesiredVersion: number;
  inventoryAppliedVersion: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

/**
 * Classify listing health into readiness, capability health, and issue state.
 */
export function classifyWixListingHealth(
  input: ClassifyWixListingHealthInput
): WixListingHealthSnapshot {
  // Check connection status
  if (input.connectionStatus !== "ACTIVE") {
    return {
      readiness: "CONNECTION_REQUIRED",
      contentHealth: "PAUSED",
      inventoryHealth: "PAUSED",
      issueCode: "CONNECTION_DISCONNECTED",
      issueMessage: "Wix connection needs to be restored",
      issueSeverity: "error",
    };
  }

  // Check for missing photos
  if (!input.hasPhotos) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: "HEALTHY",
      issueCode: "MISSING_PHOTOS",
      issueMessage: "Add at least one photo to publish on Wix",
      issueSeverity: "warning",
    };
  }

  // Check for zero price
  if (input.priceCents <= 0) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: "HEALTHY",
      issueCode: "PRICE_ZERO",
      issueMessage: "Set a price greater than $0 to publish on Wix",
      issueSeverity: "warning",
    };
  }

  // Check for API errors
  if (input.lastErrorCode) {
    const isPermanent = isPermanentWixError(input.lastErrorCode);
    return {
      readiness: isPermanent ? "ACTION_REQUIRED" : "SYNCING",
      contentHealth: isPermanent ? "PAUSED" : "DEGRADED",
      inventoryHealth: isPermanent ? "PAUSED" : "DEGRADED",
      issueCode: input.lastErrorCode,
      issueMessage: humanizeWixErrorMessage(input.lastErrorCode, input.lastErrorMessage),
      issueSeverity: isPermanent ? "error" : "warning",
    };
  }

  // Check content sync state
  const contentPending = input.contentDesiredVersion > input.contentAppliedVersion;
  const inventoryPending = input.inventoryDesiredVersion > input.inventoryAppliedVersion;

  if (contentPending || inventoryPending) {
    return {
      readiness: "SYNCING",
      contentHealth: contentPending ? "DEGRADED" : "HEALTHY",
      inventoryHealth: inventoryPending ? "DEGRADED" : "HEALTHY",
      issueCode: null,
      issueMessage: null,
      issueSeverity: null,
    };
  }

  // All healthy
  return {
    readiness: "READY_TO_PUBLISH",
    contentHealth: "HEALTHY",
    inventoryHealth: "HEALTHY",
    issueCode: null,
    issueMessage: null,
    issueSeverity: null,
  };
}

/**
 * Check if a Wix error code represents a permanent (non-retryable) error.
 */
function isPermanentWixError(errorCode: string): boolean {
  const permanentCodes = [
    "PRODUCT_NOT_FOUND",
    "INVALID_PRODUCT_ID",
    "PERMISSION_DENIED",
    "CATALOG_VERSION_MISMATCH",
    "VALIDATION_ERROR",
    "MISSING_REQUIRED_FIELD",
    "MEDIA_NOT_APPLIED",
    "VARIANT_MAP_INCOMPLETE",
  ];
  return permanentCodes.includes(errorCode);
}

/**
 * Convert Wix error codes to human-readable messages.
 * Never expose raw API error text to sellers.
 */
function humanizeWixErrorMessage(errorCode: string, rawMessage: string | null): string {
  const messages: Record<string, string> = {
    PRODUCT_NOT_FOUND: "This product was deleted on Wix",
    INVALID_PRODUCT_ID: "Product could not be found on Wix",
    PERMISSION_DENIED: "Reconnect Wix to restore sync access",
    CATALOG_VERSION_MISMATCH: "Reconnect Wix to update catalog version",
    VALIDATION_ERROR: "Check listing details and try again",
    MISSING_REQUIRED_FIELD: "Some required information is missing",
    MEDIA_NOT_APPLIED: "Wix could not use these photos. Update the listing photos and try again.",
    VARIANT_MAP_INCOMPLETE: "Wix did not return every variant. Sync will retry.",
    THROTTLED: "Sync is temporarily paused due to rate limits",
    TRANSIENT: "Sync will retry automatically",
    NETWORK: "Unable to reach Wix; will retry",
  };

  return messages[errorCode] ?? "Sync issue detected; will retry automatically";
}

/**
 * Persist listing health to the database.
 */
export async function persistWixListingHealth(
  db: WixHealthDb,
  listingLinkId: string,
  health: WixListingHealthSnapshot
): Promise<void> {
  const now = new Date();
  
  // Get existing link to check if issue already exists
  const existing = await db.wixListingLink.findUnique({
    where: { id: listingLinkId },
    select: { issueFirstSeenAt: true },
  });
  
  await db.wixListingLink.update({
    where: { id: listingLinkId },
    data: {
      readiness: health.readiness,
      contentHealth: health.contentHealth,
      inventoryHealth: health.inventoryHealth,
      issueCode: health.issueCode,
      issueMessage: health.issueMessage,
      issueSeverity: health.issueSeverity,
      issueFirstSeenAt: health.issueCode
        ? (existing?.issueFirstSeenAt ?? now)
        : null,
      issueLastSeenAt: health.issueCode ? now : null,
      readinessUpdatedAt: now,
    },
  });
}

/**
 * Clear an issue from a listing link.
 */
export async function clearWixListingIssue(
  db: WixHealthDb,
  listingLinkId: string
): Promise<void> {
  await db.wixListingLink.update({
    where: { id: listingLinkId },
    data: {
      issueCode: null,
      issueMessage: null,
      issueSeverity: null,
      issueFingerprint: null,
      issueFirstSeenAt: null,
      issueLastSeenAt: null,
    },
  });
}

/**
 * Enqueue due listing reconciliation jobs.
 */
export async function enqueueDueWixListingReconciliations(
  db: PrismaClient,
  input: {
    connectionId: string;
    maxItems?: number;
    reconcileAfter?: Date;
  }
): Promise<{ enqueued: number }> {
  const maxItems = input.maxItems ?? 100;
  const reconcileAfter = input.reconcileAfter ?? new Date(Date.now() - 5 * 60 * 1000);

  const links = await db.wixListingLink.findMany({
    where: {
      wixConnectionId: input.connectionId,
      OR: [
        { lastReconciledAt: null },
        { lastReconciledAt: { lt: reconcileAfter } },
      ],
    },
    select: { id: true },
    take: maxItems,
    orderBy: { lastReconciledAt: "asc" },
  });

  let enqueued = 0;
  for (const link of links) {
    try {
      await enqueueWixSyncJob(db, {
        wixConnectionId: input.connectionId,
        kind: "RECONCILE_LISTING",
        dedupeKey: wixReconcileListingDedupeKey(link.id),
        payload: { listingLinkId: link.id },
      });
      enqueued++;
    } catch {
      // Job may already exist
    }
  }

  return { enqueued };
}

/**
 * Mark a listing as reconciled.
 */
export async function markWixListingReconciled(
  db: WixHealthDb,
  listingLinkId: string
): Promise<void> {
  await db.wixListingLink.update({
    where: { id: listingLinkId },
    data: { lastReconciledAt: new Date() },
  });
}

/**
 * Get seller-facing listing status.
 */
export type WixListingPublicStatus = {
  readiness: WixListingReadiness;
  canSync: boolean;
  issueMessage: string | null;
};

export function toPublicWixListingStatus(
  link: { readiness: WixListingReadiness; issueMessage: string | null }
): WixListingPublicStatus {
  return {
    readiness: link.readiness,
    canSync: link.readiness !== "CONNECTION_REQUIRED",
    issueMessage: link.issueMessage,
  };
}

/**
 * Persist a human-readable issue when an outbound Wix job dies.
 */
export async function recordWixDeadJobIssue(
  db: PrismaClient,
  input: {
    wixConnectionId: string;
    listingLinkId?: string | null;
    storeItemId?: string | null;
    errorCode: string;
    errorMessage?: string | null;
  }
): Promise<void> {
  const link = input.listingLinkId
    ? await db.wixListingLink.findUnique({
        where: { id: input.listingLinkId },
        include: {
          connection: { select: { status: true } },
          storeItem: { select: { priceCents: true, photos: true } },
          variantMaps: {
            select: { inventoryDesiredVersion: true, inventoryAppliedVersion: true },
          },
        },
      })
    : input.storeItemId
      ? await db.wixListingLink.findFirst({
          where: { wixConnectionId: input.wixConnectionId, storeItemId: input.storeItemId },
          include: {
            connection: { select: { status: true } },
            storeItem: { select: { priceCents: true, photos: true } },
            variantMaps: {
              select: { inventoryDesiredVersion: true, inventoryAppliedVersion: true },
            },
          },
        })
      : null;
  if (!link) return;

  const photos = Array.isArray(link.storeItem.photos) ? link.storeItem.photos : [];
  const health = classifyWixListingHealth({
    connectionStatus: link.connection.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED",
    remoteProductVisible: link.remoteProductVisible,
    hasPhotos: photos.some((photo) => typeof photo === "string" && photo.trim().length > 0),
    priceCents: link.storeItem.priceCents,
    contentDesiredVersion: link.desiredProductContentVersion,
    contentAppliedVersion: link.appliedProductContentVersion,
    inventoryDesiredVersion: link.variantMaps.reduce(
      (max, map) => Math.max(max, map.inventoryDesiredVersion),
      0
    ),
    inventoryAppliedVersion: link.variantMaps.reduce(
      (max, map) => Math.max(max, map.inventoryAppliedVersion),
      0
    ),
    lastErrorCode: input.errorCode,
    lastErrorMessage: input.errorMessage ?? null,
  });
  await persistWixListingHealth(db, link.id, health);
}
