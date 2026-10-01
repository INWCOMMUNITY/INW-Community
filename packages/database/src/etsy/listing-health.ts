import type {
  EtsyCapabilityHealth,
  EtsyListingLink,
  EtsyListingReadiness,
  EtsyVariantMap,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { enqueueEtsySyncJob } from "./jobs";

export type EtsyHealthDb = PrismaClient | Prisma.TransactionClient;

export type EtsyListingHealthSnapshot = {
  readiness: EtsyListingReadiness;
  contentHealth: EtsyCapabilityHealth;
  inventoryHealth: EtsyCapabilityHealth;
  issueCode: string | null;
  issueMessage: string | null;
};

export function classifyEtsyListingHealth(input: {
  connectionStatus: string;
  listing: Pick<
    EtsyListingLink,
    | "desiredProductContentVersion"
    | "appliedProductContentVersion"
    | "productContentConflict"
    | "contentHealth"
    | "inventoryHealth"
  >;
  variantMaps: Array<
    Pick<
      EtsyVariantMap,
      | "desiredVariantContentVersion"
      | "appliedVariantContentVersion"
      | "variantContentConflict"
      | "inventoryDesiredVersion"
      | "inventoryAppliedVersion"
      | "inventoryDesiredAvailable"
      | "inventoryAppliedAvailable"
    >
  >;
  hasCausalSaleConflict: boolean;
}): EtsyListingHealthSnapshot {
  if (input.connectionStatus !== "ACTIVE") {
    return {
      readiness: "CONNECTION_REQUIRED",
      contentHealth: "PAUSED",
      inventoryHealth: "PAUSED",
      issueCode: "CONNECTION_INACTIVE",
      issueMessage: "Etsy connection is not active",
    };
  }

  if (input.hasCausalSaleConflict || input.listing.productContentConflict) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: input.listing.inventoryHealth,
      issueCode: input.hasCausalSaleConflict ? "SALE_FACT_CONFLICT" : "CONTENT_CONFLICT",
      issueMessage: input.hasCausalSaleConflict
        ? "A paid order fact conflict needs review"
        : "Etsy listing content conflict needs review",
    };
  }

  if (input.variantMaps.some((m) => m.variantContentConflict)) {
    return {
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
      inventoryHealth: input.listing.inventoryHealth,
      issueCode: "VARIANT_CONTENT_CONFLICT",
      issueMessage: "An Etsy variant price/SKU conflict needs review",
    };
  }

  const contentPending =
    input.listing.desiredProductContentVersion > input.listing.appliedProductContentVersion ||
    input.variantMaps.some((m) => m.desiredVariantContentVersion > m.appliedVariantContentVersion);
  const inventoryPending = input.variantMaps.some(
    (m) =>
      m.inventoryDesiredVersion > m.inventoryAppliedVersion ||
      (m.inventoryDesiredAvailable != null &&
        m.inventoryDesiredAvailable !== m.inventoryAppliedAvailable)
  );

  if (contentPending || inventoryPending) {
    return {
      readiness: "SYNCING",
      contentHealth: contentPending ? "DEGRADED" : "HEALTHY",
      inventoryHealth: inventoryPending ? "DEGRADED" : "HEALTHY",
      issueCode: contentPending ? "CONTENT_SYNC_PENDING" : "INVENTORY_SYNC_PENDING",
      issueMessage: contentPending
        ? "Outbound content sync is in progress"
        : "Outbound inventory sync is in progress",
    };
  }

  return {
    readiness: "READY_TO_PUBLISH",
    contentHealth: "HEALTHY",
    inventoryHealth: "HEALTHY",
    issueCode: null,
    issueMessage: null,
  };
}

export async function persistEtsyListingHealth(
  db: EtsyHealthDb,
  input: {
    listingLinkId: string;
    health: EtsyListingHealthSnapshot;
  }
): Promise<void> {
  await db.etsyListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      readiness: input.health.readiness,
      contentHealth: input.health.contentHealth,
      inventoryHealth: input.health.inventoryHealth,
      issueCode: input.health.issueCode,
      issueMessage: input.health.issueMessage,
    },
  });
}

export function etsyReconcileListingDedupeKey(input: {
  connectionId: string;
  listingLinkId: string;
  bucket: number;
}): string {
  return `RECONCILE_LISTING:${input.connectionId}:${input.listingLinkId}:b${input.bucket}`;
}

export async function ensureEtsyReconcileListingJob(
  db: EtsyHealthDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    storeItemId: string;
    bucket: number;
  }
) {
  return enqueueEtsySyncJob(db, {
    etsyConnectionId: input.connectionId,
    kind: "RECONCILE_LISTING",
    dedupeKey: etsyReconcileListingDedupeKey({
      connectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      bucket: input.bucket,
    }),
    payload: {
      listingLinkId: input.listingLinkId,
      storeItemId: input.storeItemId,
    },
  });
}

/**
 * Enqueue bounded reconcile jobs for mapped Etsy listings (DB health refresh).
 */
export async function enqueueDueEtsyListingReconciliations(
  db: PrismaClient,
  input?: { limit?: number; now?: Date; bucketMs?: number }
): Promise<{ enqueued: number }> {
  const now = input?.now ?? new Date();
  const limit = Math.max(1, Math.min(50, input?.limit ?? 25));
  const bucketMs = input?.bucketMs ?? 15 * 60 * 1000;
  const bucket = Math.floor(now.getTime() / bucketMs);

  const links = await db.etsyListingLink.findMany({
    where: {
      connection: { status: "ACTIVE" },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      etsyConnectionId: true,
      storeItemId: true,
    },
  });

  let enqueued = 0;
  for (const link of links) {
    await ensureEtsyReconcileListingJob(db, {
      connectionId: link.etsyConnectionId,
      listingLinkId: link.id,
      storeItemId: link.storeItemId,
      bucket,
    });
    enqueued += 1;
  }
  return { enqueued };
}

export async function reconcileEtsyListingHealthFromDb(
  db: PrismaClient,
  input: { connectionId: string; listingLinkId: string }
): Promise<EtsyListingHealthSnapshot | null> {
  const connection = await db.etsyConnection.findUnique({
    where: { id: input.connectionId },
    select: { id: true, status: true },
  });
  if (!connection) return null;

  const listing = await db.etsyListingLink.findFirst({
    where: { id: input.listingLinkId, etsyConnectionId: input.connectionId },
  });
  if (!listing) return null;

  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: listing.id, etsyConnectionId: input.connectionId },
  });
  const saleConflict = await db.etsyOrderLineSaleFact.count({
    where: {
      etsyConnectionId: input.connectionId,
      storeItemId: listing.storeItemId,
      causalConflict: true,
    },
  });

  const health = classifyEtsyListingHealth({
    connectionStatus: connection.status,
    listing,
    variantMaps,
    hasCausalSaleConflict: saleConflict > 0,
  });
  await persistEtsyListingHealth(db, { listingLinkId: listing.id, health });
  return health;
}

/** Stable seller-activity / push dedupe for Etsy listing issues (mapped or create-failed). */
export function etsyListingIssueDedupeKey(input: {
  connectionId: string;
  /** Listing link id, or `create-job:<jobId>` / `store-item:<id>` for unmapped creates. */
  subjectId: string;
  issueCode: string;
  issueFingerprint: string;
}): string {
  return `etsy-issue:${input.connectionId}:${input.subjectId}:${input.issueCode}:${input.issueFingerprint}`;
}

export type { Prisma };
