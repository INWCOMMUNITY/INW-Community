import type { Prisma, PrismaClient, ShopifySyncJob } from "@prisma/client";
import {
  shopifyProductContentFingerprint,
  shopifyUpdateListingContentDedupeKey,
  shopifyVariantContentFingerprint,
} from "./content-fingerprint";
import { enqueueShopifySyncJob } from "./jobs";

export type ShopifyContentDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyListingContentSnapshot = {
  title: string;
  description: string | null;
  priceCents: number;
  sku: string | null;
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
  const productChanged =
    input.before.title !== input.after.title ||
    (input.before.description ?? null) !== (input.after.description ?? null);
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
  if (variantMaps.length !== 1) {
    return { status: "SKIPPED", reason: "UNSUPPORTED" };
  }
  const variantMap = variantMaps[0];

  let syncedVariantPriceSku = false;
  if (variantChanged) {
    await db.storeVariant.update({
      where: { id: variantMap.storeVariantId },
      data: {
        priceCents: input.after.priceCents,
        sku: input.after.sku,
      },
    });
    syncedVariantPriceSku = true;
  }

  const productFingerprint = shopifyProductContentFingerprint({
    title: input.after.title,
    description: input.after.description,
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
