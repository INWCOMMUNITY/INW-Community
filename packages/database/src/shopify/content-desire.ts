import type { Prisma, PrismaClient, ShopifySyncJob } from "@prisma/client";
import {
  normalizeShopifyPhotoUrls,
  shopifyProductContentFingerprint,
  shopifyUpdateListingContentDedupeKey,
  shopifyVariantContentFingerprint,
} from "./content-fingerprint";
import { planShopifyMediaDesireFromPhotos, upsertShopifyMediaDesireMaps } from "./media-map";
import { enqueueShopifySyncJob } from "./jobs";

export type ShopifyContentDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyListingContentSnapshot = {
  title: string;
  description: string | null;
  priceCents: number;
  sku: string | null;
  /** Optional — when omitted, photos are treated as unchanged. */
  photos?: string[] | null;
};

export type RecordShopifyListingContentDesireResult =
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
export async function ensureShopifyUpdateListingContentJob(
  db: ShopifyContentDb,
  input: {
    connectionId: string;
    storeItemId: string;
    storeVariantId: string;
    productDesiredVersion: number;
    variantDesiredVersion: number;
  }
): Promise<ShopifySyncJob> {
  return enqueueShopifySyncJob(db, {
    shopifyConnectionId: input.connectionId,
    kind: "UPDATE_LISTING_CONTENT",
    dedupeKey: shopifyUpdateListingContentDedupeKey({
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
 * No Shopify network calls.
 *
 * A new seller edit on a conflicted group clears that group's conflict (explicit local intent).
 */
export async function recordShopifyListingContentDesire(
  db: ShopifyContentDb,
  input: {
    memberId: string;
    storeItemId: string;
    before: ShopifyListingContentSnapshot;
    after: ShopifyListingContentSnapshot;
  }
): Promise<RecordShopifyListingContentDesireResult> {
  const beforePhotos =
    input.before.photos !== undefined
      ? normalizeShopifyPhotoUrls(input.before.photos)
      : null;
  const afterPhotos =
    input.after.photos !== undefined ? normalizeShopifyPhotoUrls(input.after.photos) : null;
  const photosChanged =
    beforePhotos != null &&
    afterPhotos != null &&
    JSON.stringify(beforePhotos) !== JSON.stringify(afterPhotos);

  const productChanged =
    input.before.title !== input.after.title ||
    (input.before.description ?? null) !== (input.after.description ?? null) ||
    photosChanged;
  const variantChanged =
    input.before.priceCents !== input.after.priceCents ||
    (input.before.sku ?? null) !== (input.after.sku ?? null);

  if (!productChanged && !variantChanged) {
    return { status: "SKIPPED", reason: "NO_CONTENT_CHANGE" };
  }

  const connection = await db.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, status: true, primaryLocationId: true },
  });
  if (!connection) {
    return { status: "SKIPPED", reason: "CONNECTION_INACTIVE" };
  }

  const listing = await db.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_storeItemId: {
        shopifyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (!listing) {
    return { status: "SKIPPED", reason: "UNMAPPED" };
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shopify-content-inbound:${listing.id}`}))`;
  const lockedListing = await db.shopifyListingLink.findUniqueOrThrow({
    where: { id: listing.id },
  });

  const variantMaps = await db.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: lockedListing.id, shopifyConnectionId: connection.id },
    orderBy: { createdAt: "asc" },
  });
  if (variantMaps.length === 0) {
    return { status: "SKIPPED", reason: "UNSUPPORTED" };
  }
  // Prefer the variant whose mapped StoreVariant matches the edited canonical price/sku row
  // when exactly one map shares the after price+sku; else use the first map (product-only edits).
  let variantMap = variantMaps[0];
  if (variantChanged && variantMaps.length > 1) {
    const match = variantMaps.find((row) => row.storeVariantId);
    // Keep first map for product-scoped jobs; per-variant price edits are applied below
    // onto every mapped StoreVariant that still mirrors the StoreItem scalar snapshot.
    variantMap = match ?? variantMaps[0];
  }

  let syncedVariantPriceSku = false;
  if (variantChanged) {
    // Single-variant listings: keep StoreVariant in lockstep with StoreItem scalars.
    // Multi-variant: only update the StoreVariant that currently matches the before snapshot
    // (seller edited the StoreItem scalar facade for that mapped row).
    if (variantMaps.length === 1) {
      await db.storeVariant.update({
        where: { id: variantMap.storeVariantId },
        data: {
          priceCents: input.after.priceCents,
          sku: input.after.sku,
        },
      });
      syncedVariantPriceSku = true;
    } else {
      const mirrored = await db.storeVariant.findMany({
        where: {
          id: { in: variantMaps.map((row) => row.storeVariantId) },
          priceCents: input.before.priceCents,
          sku: input.before.sku,
        },
        select: { id: true },
      });
      if (mirrored.length === 1) {
        await db.storeVariant.update({
          where: { id: mirrored[0].id },
          data: {
            priceCents: input.after.priceCents,
            sku: input.after.sku,
          },
        });
        variantMap =
          variantMaps.find((row) => row.storeVariantId === mirrored[0].id) ?? variantMap;
        syncedVariantPriceSku = true;
      }
    }
  }

  const productFingerprint = shopifyProductContentFingerprint({
    title: input.after.title,
    description: input.after.description,
    photos: afterPhotos ?? undefined,
  });
  const variantFingerprint = shopifyVariantContentFingerprint({
    priceCents: input.after.priceCents,
    sku: input.after.sku,
  });

  const nextProductVersion = productChanged
    ? lockedListing.desiredProductContentVersion + 1
    : lockedListing.desiredProductContentVersion;
  const nextVariantVersion = variantChanged
    ? variantMap.desiredVariantContentVersion + 1
    : variantMap.desiredVariantContentVersion;
  const desiredAt = new Date();

  if (productChanged) {
    await db.shopifyListingLink.update({
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
    // Explicit local intent clears field-level TITLE/DESCRIPTION/MEDIA conflicts.
    await db.shopifyListingFieldState.updateMany({
      where: {
        shopifyListingLinkId: lockedListing.id,
        storeVariantId: "",
        fieldKey: { in: ["TITLE", "DESCRIPTION", "MEDIA"] },
      },
      data: {
        conflict: false,
        conflictRemoteFingerprint: null,
        conflictEvidenceId: null,
        conflictDetectedAt: null,
      },
    });

    if (photosChanged && afterPhotos) {
      const existingMaps = await db.shopifyMediaMap.findMany({
        where: { shopifyListingLinkId: lockedListing.id },
        select: {
          inwMediaId: true,
          sourceUrl: true,
          status: true,
          position: true,
          shopifyMediaId: true,
        },
      });
      const mediaPlan = planShopifyMediaDesireFromPhotos(afterPhotos, existingMaps);
      await upsertShopifyMediaDesireMaps(db, {
        connectionId: connection.id,
        listingLinkId: lockedListing.id,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        desired: mediaPlan.desired,
        removeInwMediaIds: mediaPlan.toRemove,
      });
    }
  }
  if (variantChanged) {
    await db.shopifyVariantMap.update({
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
    await db.shopifyListingFieldState.updateMany({
      where: {
        shopifyListingLinkId: lockedListing.id,
        storeVariantId: variantMap.storeVariantId,
        fieldKey: { in: ["PRICE", "SKU"] },
      },
      data: {
        conflict: false,
        conflictRemoteFingerprint: null,
        conflictEvidenceId: null,
        conflictDetectedAt: null,
      },
    });
  }

  const job = await ensureShopifyUpdateListingContentJob(db, {
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId: variantMap.storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: nextVariantVersion,
  });

  return {
    status: "RECORDED",
    connectionId: connection.id,
    storeItemId: input.storeItemId,
    storeVariantId: variantMap.storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: nextVariantVersion,
    jobId: job.id,
    syncedVariantPriceSku,
  };
}

/**
 * Re-drive UPDATE_LISTING_CONTENT when durable media maps still need Shopify create
 * (ACTIVE/pending rows without shopifyMediaId, or photos with no maps yet).
 * Safe to call from reconcile or a one-shot repair — no Shopify network I/O.
 */
export async function requeueShopifyContentForUnpushedMedia(
  db: ShopifyContentDb,
  input: {
    connectionId: string;
    listingLinkId: string;
    storeItemId: string;
    memberId: string;
  }
): Promise<
  | { status: "SKIPPED"; reason: "LISTING_MISSING" | "NO_MEDIA_WORK" | "UNSUPPORTED" }
  | {
      status: "RECORDED";
      productDesiredVersion: number;
      variantDesiredVersion: number;
      jobId: string;
      toAdd: number;
    }
> {
  const listing = await db.shopifyListingLink.findFirst({
    where: {
      id: input.listingLinkId,
      shopifyConnectionId: input.connectionId,
      storeItemId: input.storeItemId,
    },
  });
  if (!listing) return { status: "SKIPPED", reason: "LISTING_MISSING" };

  const storeItem = await db.storeItem.findUnique({
    where: { id: input.storeItemId },
    select: { photos: true, title: true, description: true },
  });
  if (!storeItem) return { status: "SKIPPED", reason: "LISTING_MISSING" };

  const photos = normalizeShopifyPhotoUrls(storeItem.photos);
  const existingMaps = await db.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: listing.id },
    select: {
      inwMediaId: true,
      sourceUrl: true,
      status: true,
      position: true,
      shopifyMediaId: true,
    },
  });
  const mediaPlan = planShopifyMediaDesireFromPhotos(photos, existingMaps);
  if (
    mediaPlan.toAdd.length === 0 &&
    mediaPlan.toRemove.length === 0 &&
    mediaPlan.toReorder.length === 0
  ) {
    return { status: "SKIPPED", reason: "NO_MEDIA_WORK" };
  }

  const variantMap = await db.shopifyVariantMap.findFirst({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: input.connectionId },
    orderBy: { createdAt: "asc" },
  });
  if (!variantMap) return { status: "SKIPPED", reason: "UNSUPPORTED" };

  await upsertShopifyMediaDesireMaps(db, {
    connectionId: input.connectionId,
    listingLinkId: listing.id,
    memberId: input.memberId,
    storeItemId: input.storeItemId,
    desired: mediaPlan.desired,
    removeInwMediaIds: mediaPlan.toRemove,
  });

  const productFingerprint = shopifyProductContentFingerprint({
    title: storeItem.title,
    description: storeItem.description,
    photos,
  });
  const nextProductVersion =
    listing.desiredProductContentVersion > listing.appliedProductContentVersion
      ? listing.desiredProductContentVersion
      : listing.desiredProductContentVersion + 1;
  const desiredAt = new Date();

  if (nextProductVersion !== listing.desiredProductContentVersion) {
    await db.shopifyListingLink.update({
      where: { id: listing.id },
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

  const job = await ensureShopifyUpdateListingContentJob(db, {
    connectionId: input.connectionId,
    storeItemId: input.storeItemId,
    storeVariantId: variantMap.storeVariantId,
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: variantMap.desiredVariantContentVersion,
  });

  return {
    status: "RECORDED",
    productDesiredVersion: nextProductVersion,
    variantDesiredVersion: variantMap.desiredVariantContentVersion,
    jobId: job.id,
    toAdd: mediaPlan.toAdd.length,
  };
}

/**
 * After StoreVariant price/SKU rows change (matrix edits), bump desire on every
 * mapped variant whose canonical fingerprint differs from applied/desired and
 * enqueue per-variant UPDATE_LISTING_CONTENT jobs.
 */
export async function recordShopifyDirtyMappedVariantContentDesires(
  db: ShopifyContentDb,
  input: { memberId: string; storeItemId: string }
): Promise<{ status: "SKIPPED" | "RECORDED"; dirtyCount: number }> {
  const connection = await db.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) return { status: "SKIPPED", dirtyCount: 0 };

  const listing = await db.shopifyListingLink.findUnique({
    where: {
      shopifyConnectionId_storeItemId: {
        shopifyConnectionId: connection.id,
        storeItemId: input.storeItemId,
      },
    },
  });
  if (!listing) return { status: "SKIPPED", dirtyCount: 0 };

  const variantMaps = await db.shopifyVariantMap.findMany({
    where: { shopifyListingLinkId: listing.id, shopifyConnectionId: connection.id },
  });
  if (variantMaps.length < 1) return { status: "SKIPPED", dirtyCount: 0 };

  const storeVariants = await db.storeVariant.findMany({
    where: { id: { in: variantMaps.map((m) => m.storeVariantId) } },
    select: { id: true, priceCents: true, sku: true, status: true },
  });
  const byId = new Map(storeVariants.map((v) => [v.id, v]));
  const desiredAt = new Date();
  let dirtyCount = 0;

  for (const map of variantMaps) {
    const sv = byId.get(map.storeVariantId);
    if (!sv || sv.status !== "ACTIVE") continue;
    const fingerprint = shopifyVariantContentFingerprint({
      priceCents: sv.priceCents,
      sku: sv.sku,
    });
    if (
      fingerprint === map.desiredVariantFingerprint &&
      map.desiredVariantContentVersion > map.appliedVariantContentVersion
    ) {
      // Already desired; ensure job exists.
      await ensureShopifyUpdateListingContentJob(db, {
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
    await db.shopifyVariantMap.update({
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
    await db.shopifyListingFieldState.updateMany({
      where: {
        shopifyListingLinkId: listing.id,
        storeVariantId: map.storeVariantId,
        fieldKey: { in: ["PRICE", "SKU"] },
      },
      data: {
        conflict: false,
        conflictRemoteFingerprint: null,
        conflictEvidenceId: null,
        conflictDetectedAt: null,
      },
    });
    await ensureShopifyUpdateListingContentJob(db, {
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

export async function markShopifyProductContentApplied(
  db: ShopifyContentDb,
  input: {
    listingLinkId: string;
    desiredVersion: number;
    fingerprint: string;
    now?: Date;
  }
): Promise<void> {
  await db.shopifyListingLink.updateMany({
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

export async function markShopifyVariantContentApplied(
  db: ShopifyContentDb,
  input: {
    variantMapId: string;
    desiredVersion: number;
    fingerprint: string;
    now?: Date;
  }
): Promise<void> {
  await db.shopifyVariantMap.updateMany({
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

export async function setShopifyProductContentConflict(
  db: ShopifyContentDb,
  input: {
    listingLinkId: string;
    remoteFingerprint: string;
    evidenceId?: string | null;
    now?: Date;
  }
): Promise<void> {
  await db.shopifyListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      productContentConflict: true,
      productConflictRemoteFingerprint: input.remoteFingerprint,
      productConflictEvidenceId: input.evidenceId ?? null,
      productConflictDetectedAt: input.now ?? new Date(),
    },
  });
}

export async function setShopifyVariantContentConflict(
  db: ShopifyContentDb,
  input: {
    variantMapId: string;
    remoteFingerprint: string;
    evidenceId?: string | null;
    now?: Date;
  }
): Promise<void> {
  await db.shopifyVariantMap.update({
    where: { id: input.variantMapId },
    data: {
      variantContentConflict: true,
      variantConflictRemoteFingerprint: input.remoteFingerprint,
      variantConflictEvidenceId: input.evidenceId ?? null,
      variantConflictDetectedAt: input.now ?? new Date(),
    },
  });
}

export async function clearShopifyProductContentConflict(
  db: ShopifyContentDb,
  listingLinkId: string
): Promise<void> {
  await db.shopifyListingLink.update({
    where: { id: listingLinkId },
    data: {
      productContentConflict: false,
      productConflictRemoteFingerprint: null,
      productConflictEvidenceId: null,
      productConflictDetectedAt: null,
    },
  });
}

export async function clearShopifyVariantContentConflict(
  db: ShopifyContentDb,
  variantMapId: string
): Promise<void> {
  await db.shopifyVariantMap.update({
    where: { id: variantMapId },
    data: {
      variantContentConflict: false,
      variantConflictRemoteFingerprint: null,
      variantConflictEvidenceId: null,
      variantConflictDetectedAt: null,
    },
  });
}

export type { ShopifySyncJob };
