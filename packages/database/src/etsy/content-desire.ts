import type { Prisma, PrismaClient, EtsySyncJob } from "@prisma/client";
import {
  etsyProductContentFingerprint,
  etsyUpdateListingContentDedupeKey,
  etsyVariantContentFingerprint,
  normalizeEtsyDescription,
  normalizeEtsyPhotoUrls,
  normalizeEtsyTitle,
} from "./content-fingerprint";
import { enqueueEtsySyncJob } from "./jobs";
import { reconcileEtsyListingHealthFromDb } from "./listing-health";

export type EtsyContentDb = PrismaClient | Prisma.TransactionClient;

export type EtsyListingContentSnapshot = {
  title: string;
  description: string | null;
  priceCents: number;
  sku: string | null;
  /** Optional — when omitted, photos are treated as unchanged. */
  photos?: string[] | null;
};

export type RecordEtsyListingContentDesireResult =
  | { status: "SKIPPED"; reason: "UNMAPPED" | "CONNECTION_INACTIVE" | "UNSUPPORTED" | "NO_CONTENT_CHANGE" }
  | {
      status: "RECORDED";
      connectionId: string;
      storeItemId: string;
      storeVariantId: string;
      productDesiredVersion: number;
      variantDesiredVersion: number;
      jobId: string;
      syncedVariantPriceSku: boolean;
    };

/** Idempotent enqueue for an existing desired version pair (no version bump). */
export async function ensureEtsyUpdateListingContentJob(
  db: EtsyContentDb,
  input: {
    connectionId: string;
    storeItemId: string;
    storeVariantId: string;
    productDesiredVersion: number;
    variantDesiredVersion: number;
  }
): Promise<EtsySyncJob> {
  return enqueueEtsySyncJob(db, {
    etsyConnectionId: input.connectionId,
    kind: "UPDATE_LISTING_CONTENT",
    dedupeKey: etsyUpdateListingContentDedupeKey({
      connectionId: input.connectionId,
      storeItemId: input.storeItemId,
      storeVariantId: input.storeVariantId,
      productDesiredVersion: input.productDesiredVersion,
      variantDesiredVersion: input.variantDesiredVersion,
    }),
    payload: {
      storeItemId: input.storeItemId,
      storeVariantId: input.storeVariantId,
      productDesiredVersion: input.productDesiredVersion,
      variantDesiredVersion: input.variantDesiredVersion,
    },
  });
}

/**
 * After a canonical StoreItem content edit, bump desired versions and enqueue
 * UPDATE_LISTING_CONTENT when a current-generation mapping exists.
 * Must run inside the same DB transaction as the canonical write.
 * No Etsy network calls.
 */
export async function recordEtsyListingContentDesire(
  db: EtsyContentDb,
  input: {
    memberId: string;
    storeItemId: string;
    before: EtsyListingContentSnapshot;
    after: EtsyListingContentSnapshot;
  }
): Promise<RecordEtsyListingContentDesireResult> {
  const beforePhotos =
    input.before.photos !== undefined ? normalizeEtsyPhotoUrls(input.before.photos) : null;
  const afterPhotos =
    input.after.photos !== undefined ? normalizeEtsyPhotoUrls(input.after.photos) : null;
  const photosChanged =
    beforePhotos != null &&
    afterPhotos != null &&
    JSON.stringify(beforePhotos) !== JSON.stringify(afterPhotos);

  const productChanged =
    normalizeEtsyTitle(input.before.title) !== normalizeEtsyTitle(input.after.title) ||
    normalizeEtsyDescription(input.before.description) !==
      normalizeEtsyDescription(input.after.description) ||
    photosChanged;
  const variantChanged =
    input.before.priceCents !== input.after.priceCents ||
    (input.before.sku ?? null) !== (input.after.sku ?? null);

  if (!productChanged && !variantChanged) {
    return { status: "SKIPPED", reason: "NO_CONTENT_CHANGE" };
  }

  const connection = await db.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const listing = await db.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (!listing) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`etsy-content-outbound:${listing.id}`}))`;
  const lockedListing = await db.etsyListingLink.findUniqueOrThrow({
    where: { id: listing.id },
  });

  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: lockedListing.id, etsyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length === 0) {
    return { status: "SKIPPED", reason: "UNSUPPORTED" };
  }

  let variantMap = variantMaps[0]!;
  let syncedVariantPriceSku = false;
  const mapsToBump: Array<{ map: (typeof variantMaps)[number]; nextVersion: number }> = [];

  if (variantChanged) {
    if (variantMaps.length === 1) {
      await db.storeVariant.update({
        where: { id: variantMap.storeVariantId },
        data: {
          priceCents: input.after.priceCents,
          sku: input.after.sku,
        },
      });
      syncedVariantPriceSku = true;
      mapsToBump.push({
        map: variantMap,
        nextVersion: variantMap.desiredVariantContentVersion + 1,
      });
    } else {
      // Listing-level price/SKU edit: push onto every mapped StoreVariant that still
      // matched the previous facade price/SKU (uniform bump), then desire each map.
      const mirrored = await db.storeVariant.findMany({
        where: {
          id: { in: variantMaps.map((row) => row.storeVariantId) },
          priceCents: input.before.priceCents,
          sku: input.before.sku,
        },
        select: { id: true },
      });
      if (mirrored.length >= 1) {
        await db.storeVariant.updateMany({
          where: { id: { in: mirrored.map((row) => row.id) } },
          data: {
            priceCents: input.after.priceCents,
            sku: input.after.sku,
          },
        });
        syncedVariantPriceSku = true;
        const mirroredIds = new Set(mirrored.map((row) => row.id));
        for (const map of variantMaps) {
          if (!mirroredIds.has(map.storeVariantId)) continue;
          mapsToBump.push({
            map,
            nextVersion: map.desiredVariantContentVersion + 1,
          });
        }
        variantMap =
          variantMaps.find((row) => mirroredIds.has(row.storeVariantId)) ?? variantMap;
      } else {
        // No StoreVariant matched the facade — still bump primary map desire so
        // UPDATE reads current StoreVariant rows via dirty pass / handler.
        mapsToBump.push({
          map: variantMap,
          nextVersion: variantMap.desiredVariantContentVersion + 1,
        });
      }
    }
  }

  const productFingerprint = etsyProductContentFingerprint({
    title: input.after.title,
    description: input.after.description,
    photos: afterPhotos ?? undefined,
  });
  const variantFingerprint = etsyVariantContentFingerprint({
    priceCents: input.after.priceCents,
    sku: input.after.sku,
  });

  const nextProductVersion = productChanged
    ? lockedListing.desiredProductContentVersion + 1
    : lockedListing.desiredProductContentVersion;
  const desiredAt = new Date();

  if (productChanged) {
    await db.etsyListingLink.update({
      where: { id: lockedListing.id },
      data: {
        desiredProductContentVersion: nextProductVersion,
        desiredProductFingerprint: productFingerprint,
        productDesiredAt: desiredAt,
        productContentConflict: false,
        productConflictRemoteFingerprint: null,
        productConflictEvidenceId: null,
        productConflictDetectedAt: null,
      },
    });
  }

  let nextVariantVersion = variantMap.desiredVariantContentVersion;
  if (mapsToBump.length > 0) {
    for (const row of mapsToBump) {
      const fp =
        row.map.storeVariantId === variantMap.storeVariantId
          ? variantFingerprint
          : etsyVariantContentFingerprint({
              priceCents: input.after.priceCents,
              sku: input.after.sku,
            });
      await db.etsyVariantMap.update({
        where: { id: row.map.id },
        data: {
          desiredVariantContentVersion: row.nextVersion,
          desiredVariantFingerprint: fp,
          variantDesiredAt: desiredAt,
          variantContentConflict: false,
          variantConflictRemoteFingerprint: null,
          variantConflictEvidenceId: null,
          variantConflictDetectedAt: null,
        },
      });
      if (row.map.id === variantMap.id) nextVariantVersion = row.nextVersion;
    }
  } else if (variantChanged) {
    nextVariantVersion = variantMap.desiredVariantContentVersion + 1;
    await db.etsyVariantMap.update({
      where: { id: variantMap.id },
      data: {
        desiredVariantContentVersion: nextVariantVersion,
        desiredVariantFingerprint: variantFingerprint,
        variantDesiredAt: desiredAt,
        variantContentConflict: false,
        variantConflictRemoteFingerprint: null,
        variantConflictEvidenceId: null,
        variantConflictDetectedAt: null,
      },
    });
  }

  // Enqueue one job per bumped map (multi-price bump), else primary pair.
  const enqueueTargets =
    mapsToBump.length > 0
      ? mapsToBump.map((row) => ({
          storeVariantId: row.map.storeVariantId,
          variantDesiredVersion: row.nextVersion,
        }))
      : [
          {
            storeVariantId: variantMap.storeVariantId,
            variantDesiredVersion: nextVariantVersion,
          },
        ];

  let jobId = "";
  for (const target of enqueueTargets) {
    const job = await ensureEtsyUpdateListingContentJob(db, {
      connectionId: connection.id,
      storeItemId: input.storeItemId,
      storeVariantId: target.storeVariantId,
      productDesiredVersion: nextProductVersion,
      variantDesiredVersion: target.variantDesiredVersion,
    });
    jobId = job.id;
  }

  // Flip Sync Airport off Live immediately — do not wait for the worker.
  await reconcileEtsyListingHealthFromDb(db, {
    connectionId: connection.id,
    listingLinkId: lockedListing.id,
  }).catch(() => undefined);

  return {
    status: "RECORDED",
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId: variantMap.storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: nextVariantVersion,
    jobId,
    syncedVariantPriceSku,
  };
}

/**
 * After StoreVariant price/SKU rows change (matrix edits), bump desire on every
 * mapped variant whose canonical fingerprint differs from applied/desired.
 */
export async function recordEtsyDirtyMappedVariantContentDesires(
  db: EtsyContentDb,
  input: { memberId: string; storeItemId: string }
): Promise<{ status: "SKIPPED" | "RECORDED"; dirtyCount: number }> {
  const connection = await db.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) return { status: "SKIPPED", dirtyCount: 0 };

  const listing = await db.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (!listing) return { status: "SKIPPED", dirtyCount: 0 };

  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: listing.id, etsyConnectionId: connection.id },
  });
  if (variantMaps.length < 1) return { status: "SKIPPED", dirtyCount: 0 };

  const storeVariants = await db.storeVariant.findMany({
    where: { id: { in: variantMaps.map((m) => m.storeVariantId) } },
    select: { id: true, priceCents: true, sku: true },
  });
  const byId = new Map(storeVariants.map((v) => [v.id, v]));
  const desiredAt = new Date();
  let dirtyCount = 0;

  for (const map of variantMaps) {
    const sv = byId.get(map.storeVariantId);
    if (!sv) continue;
    const fingerprint = etsyVariantContentFingerprint({
      priceCents: sv.priceCents,
      sku: sv.sku,
    });
    if (
      fingerprint === map.desiredVariantFingerprint &&
      map.desiredVariantContentVersion > map.appliedVariantContentVersion
    ) {
      await ensureEtsyUpdateListingContentJob(db, {
        connectionId: connection.id,
        storeItemId: input.storeItemId,
        storeVariantId: map.storeVariantId,
        productDesiredVersion: listing.desiredProductContentVersion,
        variantDesiredVersion: map.desiredVariantContentVersion,
      });
      continue;
    }
    if (
      fingerprint === map.appliedVariantFingerprint &&
      map.desiredVariantContentVersion <= map.appliedVariantContentVersion
    ) {
      continue;
    }

    const nextVersion = map.desiredVariantContentVersion + 1;
    await db.etsyVariantMap.update({
      where: { id: map.id },
      data: {
        desiredVariantContentVersion: nextVersion,
        desiredVariantFingerprint: fingerprint,
        variantDesiredAt: desiredAt,
        variantContentConflict: false,
        variantConflictRemoteFingerprint: null,
        variantConflictEvidenceId: null,
        variantConflictDetectedAt: null,
      },
    });
    await ensureEtsyUpdateListingContentJob(db, {
      connectionId: connection.id,
      storeItemId: input.storeItemId,
      storeVariantId: map.storeVariantId,
      productDesiredVersion: listing.desiredProductContentVersion,
      variantDesiredVersion: nextVersion,
    });
    dirtyCount += 1;
  }

  return { status: dirtyCount > 0 ? "RECORDED" : "SKIPPED", dirtyCount };
}

export async function markEtsyProductContentApplied(
  db: EtsyContentDb,
  input: {
    listingLinkId: string;
    desiredVersion: number;
    fingerprint: string;
    now?: Date;
  }
): Promise<void> {
  await db.etsyListingLink.updateMany({
    where: {
      id: input.listingLinkId,
      appliedProductContentVersion: { lte: input.desiredVersion },
    },
    data: {
      appliedProductContentVersion: input.desiredVersion,
      appliedProductFingerprint: input.fingerprint,
      productContentAppliedAt: input.now ?? new Date(),
      productContentConflict: false,
      productConflictRemoteFingerprint: null,
      productConflictEvidenceId: null,
      productConflictDetectedAt: null,
    },
  });
}

export async function markEtsyVariantContentApplied(
  db: EtsyContentDb,
  input: {
    variantMapId: string;
    desiredVersion: number;
    fingerprint: string;
    now?: Date;
  }
): Promise<void> {
  await db.etsyVariantMap.updateMany({
    where: {
      id: input.variantMapId,
      appliedVariantContentVersion: { lte: input.desiredVersion },
    },
    data: {
      appliedVariantContentVersion: input.desiredVersion,
      appliedVariantFingerprint: input.fingerprint,
      variantContentAppliedAt: input.now ?? new Date(),
      variantContentConflict: false,
      variantConflictRemoteFingerprint: null,
      variantConflictEvidenceId: null,
      variantConflictDetectedAt: null,
    },
  });
}

export async function setEtsyProductContentConflict(
  db: EtsyContentDb,
  input: {
    listingLinkId: string;
    remoteFingerprint: string;
    evidenceId?: string | null;
    now?: Date;
  }
): Promise<void> {
  await db.etsyListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      productContentConflict: true,
      productConflictRemoteFingerprint: input.remoteFingerprint,
      productConflictEvidenceId: input.evidenceId ?? null,
      productConflictDetectedAt: input.now ?? new Date(),
    },
  });
}

export async function setEtsyVariantContentConflict(
  db: EtsyContentDb,
  input: {
    variantMapId: string;
    remoteFingerprint: string;
    evidenceId?: string | null;
    now?: Date;
  }
): Promise<void> {
  await db.etsyVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      variantContentConflict: true,
      variantConflictRemoteFingerprint: input.remoteFingerprint,
      variantConflictEvidenceId: input.evidenceId ?? null,
      variantConflictDetectedAt: input.now ?? new Date(),
    },
  });
}

export type EtsyHowItsMadeSnapshot = {
  etsyWhoMade: string | null;
  etsyWhenMade: string | null;
  etsyIsSupply: boolean | null;
  etsyTaxonomyId: number | null;
};

/**
 * After How it's made / taxonomy attributes change on a mapped listing,
 * bump product desire and enqueue UPDATE_LISTING_CONTENT (no network).
 */
export async function recordEtsyHowItsMadeDesire(
  db: EtsyContentDb,
  input: {
    memberId: string;
    storeItemId: string;
    before: EtsyHowItsMadeSnapshot;
    after: EtsyHowItsMadeSnapshot;
  }
): Promise<RecordEtsyListingContentDesireResult> {
  const changed =
    (input.before.etsyWhoMade ?? null) !== (input.after.etsyWhoMade ?? null) ||
    (input.before.etsyWhenMade ?? null) !== (input.after.etsyWhenMade ?? null) ||
    (input.before.etsyIsSupply ?? null) !== (input.after.etsyIsSupply ?? null) ||
    (input.before.etsyTaxonomyId ?? null) !== (input.after.etsyTaxonomyId ?? null);
  if (!changed) {
    return { status: "SKIPPED", reason: "NO_CONTENT_CHANGE" };
  }

  const connection = await db.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const listing = await db.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (!listing) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`etsy-content-outbound:${listing.id}`}))`;
  const lockedListing = await db.etsyListingLink.findUniqueOrThrow({
    where: { id: listing.id },
  });

  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: lockedListing.id, etsyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length === 0) {
    return { status: "SKIPPED", reason: "UNSUPPORTED" };
  }
  const variantMap = variantMaps[0]!;

  const storeItem = await db.storeItem.findUniqueOrThrow({
    where: { id: input.storeItemId },
    select: { title: true, description: true, photos: true },
  });
  const productFingerprint = etsyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos: storeItem.photos,
  });
  const nextProductVersion = lockedListing.desiredProductContentVersion + 1;
  const desiredAt = new Date();

  await db.etsyListingLink.update({
    where: { id: lockedListing.id },
    data: {
      desiredProductContentVersion: nextProductVersion,
      desiredProductFingerprint: productFingerprint,
      productDesiredAt: desiredAt,
      productContentConflict: false,
      productConflictRemoteFingerprint: null,
      productConflictEvidenceId: null,
      productConflictDetectedAt: null,
    },
  });

  const job = await ensureEtsyUpdateListingContentJob(db, {
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId: variantMap.storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: variantMap.desiredVariantContentVersion,
  });

  await reconcileEtsyListingHealthFromDb(db, {
    connectionId: connection.id,
    listingLinkId: lockedListing.id,
  }).catch(() => undefined);

  return {
    status: "RECORDED",
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId: variantMap.storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: variantMap.desiredVariantContentVersion,
    jobId: job.id,
    syncedVariantPriceSku: false,
  };
}

/**
 * After seller add/remove/replace of Variant identity on a mapped Etsy listing,
 * bump product desire and enqueue reconcile so Size×Color topology is pushed.
 */
export async function recordEtsyListingVariantTopologyDesire(
  db: EtsyContentDb,
  input: { memberId: string; storeItemId: string }
): Promise<RecordEtsyListingContentDesireResult> {
  const connection = await db.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const listing = await db.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (!listing) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`etsy-content-outbound:${listing.id}`}))`;
  const lockedListing = await db.etsyListingLink.findUniqueOrThrow({
    where: { id: listing.id },
  });

  const storeItem = await db.storeItem.findUniqueOrThrow({
    where: { id: input.storeItemId },
    select: { title: true, description: true, photos: true },
  });
  const productFingerprint = etsyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos: storeItem.photos,
  });
  const nextProductVersion = lockedListing.desiredProductContentVersion + 1;
  const desiredAt = new Date();

  await db.etsyListingLink.update({
    where: { id: lockedListing.id },
    data: {
      desiredProductContentVersion: nextProductVersion,
      desiredProductFingerprint: productFingerprint,
      productDesiredAt: desiredAt,
      productContentConflict: false,
      productConflictRemoteFingerprint: null,
      productConflictEvidenceId: null,
      productConflictDetectedAt: null,
    },
  });

  // Versioned reconcile dedupe — time-bucket reconcile does not resurrect SUCCEEDED.
  const reconcileJob = await enqueueEtsySyncJob(db, {
    etsyConnectionId: connection.id,
    kind: "RECONCILE_LISTING",
    dedupeKey: `RECONCILE_LISTING:${connection.id}:${lockedListing.id}:topo:p${nextProductVersion}`,
    payload: {
      listingLinkId: lockedListing.id,
      storeItemId: input.storeItemId,
      pushTopology: true,
    },
  });

  const activeVariant = await db.storeVariant.findFirst({
    where: { storeItemId: input.storeItemId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const variantMaps = await db.etsyVariantMap.findMany({
    where: { etsyListingLinkId: lockedListing.id, etsyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  // A full axis replace retires every previously mapped variant and deletes those
  // maps in the same transaction. The new variants have no map until the push
  // reconcile remeshes. Queueing UPDATE_LISTING_CONTENT for an unmapped id dies
  // with "no variant map matching the job payload" before that remap.
  if (variantMaps.length < 1) {
    await reconcileEtsyListingHealthFromDb(db, {
      connectionId: connection.id,
      listingLinkId: lockedListing.id,
    }).catch(() => undefined);
    if (!activeVariant) {
      return { status: "SKIPPED", reason: "UNSUPPORTED" };
    }
    return {
      status: "RECORDED",
      connectionId: connection.id,
      storeItemId: input.storeItemId,
      storeVariantId: activeVariant.id,
      productDesiredVersion: nextProductVersion,
      variantDesiredVersion: 0,
      jobId: reconcileJob.id,
      syncedVariantPriceSku: false,
    };
  }

  const storeVariantId = variantMaps[0]!.storeVariantId;
  const variantDesiredVersion = variantMaps[0]!.desiredVariantContentVersion;
  const job = await ensureEtsyUpdateListingContentJob(db, {
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion,
  });

  await reconcileEtsyListingHealthFromDb(db, {
    connectionId: connection.id,
    listingLinkId: lockedListing.id,
  }).catch(() => undefined);

  return {
    status: "RECORDED",
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion,
    jobId: job.id,
    syncedVariantPriceSku: false,
  };
}

export type { EtsySyncJob };
