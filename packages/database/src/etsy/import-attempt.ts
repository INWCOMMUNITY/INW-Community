import type { Prisma, PrismaClient, EtsyListingImportAttempt } from "@prisma/client";

export type EtsyImportAttemptDb = PrismaClient | Prisma.TransactionClient;

const STALE_STARTED_MS = 15 * 60 * 1000;

export type BeginEtsyListingImportAttemptResult =
  | { status: "READY"; attempt: EtsyListingImportAttempt; reusedCompleted: false }
  | { status: "ALREADY_COMPLETED"; attempt: EtsyListingImportAttempt; reusedCompleted: true }
  | { status: "IN_PROGRESS"; attempt: EtsyListingImportAttempt };

function attemptLockKey(connectionId: string, listingId: string): string {
  return `etsy-import:${connectionId}:${listingId}`;
}

async function healCompletedFromMapping(
  tx: EtsyImportAttemptDb,
  input: {
    memberId: string;
    connectionId: string;
    etsyListingId: string;
    stockMode: "PHYSICAL" | "MADE_TO_ORDER";
    existing: EtsyListingImportAttempt | null;
  }
): Promise<EtsyListingImportAttempt | null> {
  const mapping = await tx.etsyListingLink.findFirst({
    where: {
      etsyConnectionId: input.connectionId,
      memberId: input.memberId,
      etsyListingId: input.etsyListingId,
    },
    select: {
      id: true,
      storeItemId: true,
      importBootstrapStartedAt: true,
      variantMaps: {
        select: { etsyProductId: true, etsyOfferingId: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (!mapping) return null;

  const variant = mapping.variantMaps[0] ?? null;
  const bootstrapStartedAt =
    input.existing?.bootstrapStartedAt ??
    mapping.importBootstrapStartedAt ??
    new Date();

  if (input.existing) {
    return tx.etsyListingImportAttempt.update({
      where: { id: input.existing.id },
      data: {
        status: "COMPLETED",
        storeItemId: mapping.storeItemId,
        listingLinkId: mapping.id,
        etsyProductId: variant?.etsyProductId ?? input.existing.etsyProductId,
        etsyOfferingId: variant?.etsyOfferingId ?? input.existing.etsyOfferingId,
        bootstrapStartedAt,
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  return tx.etsyListingImportAttempt.create({
    data: {
      etsyConnectionId: input.connectionId,
      memberId: input.memberId,
      etsyListingId: input.etsyListingId,
      status: "COMPLETED",
      stockMode: input.stockMode,
      bootstrapStartedAt,
      storeItemId: mapping.storeItemId,
      listingLinkId: mapping.id,
      etsyProductId: variant?.etsyProductId ?? null,
      etsyOfferingId: variant?.etsyOfferingId ?? null,
    },
  });
}

/**
 * Start or reclaim a durable import attempt for (connection, listing id).
 * Captures bootstrapStartedAt before any remote inventory snapshot.
 */
export async function beginEtsyListingImportAttempt(
  db: PrismaClient,
  input: {
    memberId: string;
    connectionId: string;
    etsyListingId: string;
    stockMode: "PHYSICAL" | "MADE_TO_ORDER";
    now?: Date;
  }
): Promise<BeginEtsyListingImportAttemptResult> {
  const now = input.now ?? new Date();
  const listingId = input.etsyListingId.trim();
  if (!/^\d+$/.test(listingId)) {
    throw new Error("Invalid Etsy listing id");
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${attemptLockKey(input.connectionId, listingId)}))`;

    const existing = await tx.etsyListingImportAttempt.findUnique({
      where: {
        etsyConnectionId_etsyListingId: {
          etsyConnectionId: input.connectionId,
          etsyListingId: listingId,
        },
      },
    });

    if (existing?.status === "COMPLETED") {
      return { status: "ALREADY_COMPLETED", attempt: existing, reusedCompleted: true };
    }

    const healed = await healCompletedFromMapping(tx, {
      memberId: input.memberId,
      connectionId: input.connectionId,
      etsyListingId: listingId,
      stockMode: input.stockMode,
      existing,
    });
    if (healed) {
      return { status: "ALREADY_COMPLETED", attempt: healed, reusedCompleted: true };
    }

    if (existing?.status === "STARTED") {
      const age = now.getTime() - existing.updatedAt.getTime();
      if (age < STALE_STARTED_MS) {
        return { status: "IN_PROGRESS", attempt: existing };
      }
      const reclaimed = await tx.etsyListingImportAttempt.update({
        where: { id: existing.id },
        data: {
          status: "STARTED",
          stockMode: input.stockMode,
          bootstrapStartedAt: now,
          failureCode: null,
          failureMessage: null,
          storeItemId: null,
          listingLinkId: null,
          etsyProductId: null,
          etsyOfferingId: null,
        },
      });
      return { status: "READY", attempt: reclaimed, reusedCompleted: false };
    }

    if (existing?.status === "FAILED") {
      const restarted = await tx.etsyListingImportAttempt.update({
        where: { id: existing.id },
        data: {
          status: "STARTED",
          stockMode: input.stockMode,
          bootstrapStartedAt: now,
          failureCode: null,
          failureMessage: null,
          storeItemId: null,
          listingLinkId: null,
          etsyProductId: null,
          etsyOfferingId: null,
        },
      });
      return { status: "READY", attempt: restarted, reusedCompleted: false };
    }

    const created = await tx.etsyListingImportAttempt.create({
      data: {
        etsyConnectionId: input.connectionId,
        memberId: input.memberId,
        etsyListingId: listingId,
        status: "STARTED",
        stockMode: input.stockMode,
        bootstrapStartedAt: now,
      },
    });
    return { status: "READY", attempt: created, reusedCompleted: false };
  });
}

export async function completeEtsyListingImportAttempt(
  db: EtsyImportAttemptDb,
  input: {
    attemptId: string;
    storeItemId: string;
    listingLinkId: string;
    etsyProductId?: string | null;
    etsyOfferingId?: string | null;
  }
): Promise<EtsyListingImportAttempt> {
  return db.etsyListingImportAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: "COMPLETED",
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
      etsyProductId: input.etsyProductId ?? null,
      etsyOfferingId: input.etsyOfferingId ?? null,
      failureCode: null,
      failureMessage: null,
    },
  });
}

export async function failEtsyListingImportAttempt(
  db: EtsyImportAttemptDb,
  input: { attemptId: string; code: string; message: string }
): Promise<EtsyListingImportAttempt | null> {
  const existing = await db.etsyListingImportAttempt.findUnique({
    where: { id: input.attemptId },
  });
  if (!existing || existing.status === "COMPLETED") return existing;
  return db.etsyListingImportAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: "FAILED",
      failureCode: input.code.slice(0, 64),
      failureMessage: input.message.slice(0, 2000),
    },
  });
}
