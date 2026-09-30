import type { Prisma, PrismaClient, ShopifyListingImportAttempt } from "@prisma/client";

export type ShopifyImportAttemptDb = PrismaClient | Prisma.TransactionClient;

/** Explicit abandon rule: STARTED with no progress update for this long may be reclaimed. */
const STALE_STARTED_MS = 15 * 60 * 1000;

export type BeginShopifyListingImportAttemptResult =
  | {
      status: "READY";
      attempt: ShopifyListingImportAttempt;
      reusedCompleted: false;
    }
  | {
      status: "ALREADY_COMPLETED";
      attempt: ShopifyListingImportAttempt;
      reusedCompleted: true;
    }
  | {
      status: "IN_PROGRESS";
      attempt: ShopifyListingImportAttempt;
    };

function attemptLockKey(connectionId: string, productId: string): string {
  return `shopify-import:${connectionId}:${productId}`;
}

async function healCompletedFromMapping(
  tx: ShopifyImportAttemptDb,
  input: {
    memberId: string;
    connectionId: string;
    shopifyProductId: string;
    stockMode: "PHYSICAL" | "MADE_TO_ORDER";
    existing: ShopifyListingImportAttempt | null;
  }
): Promise<ShopifyListingImportAttempt | null> {
  const mapping = await tx.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      shopifyProductId: input.shopifyProductId,
    },
    select: {
      id: true,
      storeItemId: true,
      importBootstrapStartedAt: true,
      variantMaps: {
        select: { shopifyVariantId: true, shopifyInventoryItemId: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (!mapping) return null;

  const variant = mapping.variantMaps[0] ?? null;
  // Preserve original attempt cutoff when present; else mapping cutoff; never invent after map.
  const bootstrapStartedAt =
    input.existing?.bootstrapStartedAt ??
    mapping.importBootstrapStartedAt ??
    new Date();

  if (input.existing) {
    return tx.shopifyListingImportAttempt.update({
      where: { id: input.existing.id },
      data: {
        status: "COMPLETED",
        storeItemId: mapping.storeItemId,
        listingLinkId: mapping.id,
        shopifyVariantId: variant?.shopifyVariantId ?? input.existing.shopifyVariantId,
        shopifyInventoryItemId:
          variant?.shopifyInventoryItemId ?? input.existing.shopifyInventoryItemId,
        bootstrapStartedAt,
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  return tx.shopifyListingImportAttempt.create({
    data: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
      shopifyProductId: input.shopifyProductId,
      status: "COMPLETED",
      stockMode: input.stockMode,
      bootstrapStartedAt,
      storeItemId: mapping.storeItemId,
      listingLinkId: mapping.id,
      shopifyVariantId: variant?.shopifyVariantId ?? null,
      shopifyInventoryItemId: variant?.shopifyInventoryItemId ?? null,
    },
  });
}

/**
 * Start or reclaim a durable import attempt for (connection, product GID).
 * Captures bootstrapStartedAt before any remote inventory snapshot.
 *
 * Cutoff reuse rules:
 * - COMPLETED / mapping exists → never create a new cutoff
 * - STARTED fresh → reuse same attempt + cutoff (IN_PROGRESS)
 * - STARTED stale (>15m) with no mapping → explicit abandon; new cutoff allowed
 * - FAILED with no mapping → explicit abandon; new cutoff allowed
 */
export async function beginShopifyListingImportAttempt(
  db: PrismaClient,
  input: {
    memberId: string;
    connectionId: string;
    shopifyProductId: string;
    stockMode: "PHYSICAL" | "MADE_TO_ORDER";
    now?: Date;
  }
): Promise<BeginShopifyListingImportAttemptResult> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${attemptLockKey(
      input.connectionId,
      input.shopifyProductId
    )}))`;

    const existing = await tx.shopifyListingImportAttempt.findUnique({
      where: {
        shopifyConnectionId_shopifyProductId: {
          shopifyConnectionId: input.connectionId,
          shopifyProductId: input.shopifyProductId,
        },
      },
    });

    const healed = await healCompletedFromMapping(tx, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      shopifyProductId: input.shopifyProductId,
      stockMode: input.stockMode,
      existing,
    });
    if (healed) {
      return { status: "ALREADY_COMPLETED", attempt: healed, reusedCompleted: true };
    }

    if (existing?.status === "COMPLETED" && existing.storeItemId && existing.listingLinkId) {
      return { status: "ALREADY_COMPLETED", attempt: existing, reusedCompleted: true };
    }

    if (existing?.status === "STARTED") {
      const age = now.getTime() - existing.updatedAt.getTime();
      if (age < STALE_STARTED_MS) {
        return { status: "IN_PROGRESS", attempt: existing };
      }
      // Explicit abandon: stale STARTED with no mapping may take a new cutoff.
      const reclaimed = await tx.shopifyListingImportAttempt.update({
        where: { id: existing.id },
        data: {
          status: "STARTED",
          stockMode: input.stockMode,
          bootstrapStartedAt: now,
          shopifyVariantId: null,
          shopifyInventoryItemId: null,
          storeItemId: null,
          listingLinkId: null,
          failureCode: null,
          failureMessage: null,
        },
      });
      return { status: "READY", attempt: reclaimed, reusedCompleted: false };
    }

    if (existing?.status === "FAILED") {
      // Explicit abandon: FAILED with no mapping may take a new cutoff.
      const retried = await tx.shopifyListingImportAttempt.update({
        where: { id: existing.id },
        data: {
          status: "STARTED",
          stockMode: input.stockMode,
          bootstrapStartedAt: now,
          shopifyVariantId: null,
          shopifyInventoryItemId: null,
          storeItemId: null,
          listingLinkId: null,
          failureCode: null,
          failureMessage: null,
        },
      });
      return { status: "READY", attempt: retried, reusedCompleted: false };
    }

    const created = await tx.shopifyListingImportAttempt.create({
      data: {
        shopifyConnectionId: input.connectionId,
        memberId: input.memberId,
        shopifyProductId: input.shopifyProductId,
        status: "STARTED",
        stockMode: input.stockMode,
        bootstrapStartedAt: now,
      },
    });
    return { status: "READY", attempt: created, reusedCompleted: false };
  });
}

export async function completeShopifyListingImportAttempt(
  db: ShopifyImportAttemptDb,
  input: {
    attemptId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
    storeItemId: string;
    listingLinkId: string;
  }
): Promise<ShopifyListingImportAttempt> {
  return db.shopifyListingImportAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: "COMPLETED",
      shopifyVariantId: input.shopifyVariantId,
      shopifyInventoryItemId: input.shopifyInventoryItemId,
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
      failureCode: null,
      failureMessage: null,
    },
  });
}

/**
 * Mark attempt FAILED only when still STARTED.
 * Never downgrade COMPLETED — that would allow a new cutoff while mapping exists.
 */
export async function failShopifyListingImportAttempt(
  db: ShopifyImportAttemptDb,
  input: { attemptId: string; code: string; message: string }
): Promise<ShopifyListingImportAttempt | null> {
  const updated = await db.shopifyListingImportAttempt.updateMany({
    where: { id: input.attemptId, status: "STARTED" },
    data: {
      status: "FAILED",
      failureCode: input.code.slice(0, 64),
      failureMessage: input.message.slice(0, 500),
    },
  });
  if (updated.count === 0) return null;
  return db.shopifyListingImportAttempt.findUnique({ where: { id: input.attemptId } });
}

export type { Prisma };
