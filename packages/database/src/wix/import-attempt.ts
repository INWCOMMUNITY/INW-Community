import type { Prisma, PrismaClient, WixListingImportAttempt } from "@prisma/client";

export type WixImportAttemptDb = PrismaClient | Prisma.TransactionClient;

export type BeginWixListingImportAttemptResult =
  | { status: "STARTED"; attempt: WixListingImportAttempt }
  | { status: "ALREADY_IMPORTING"; attemptId: string }
  | {
      status: "ALREADY_COMPLETED";
      attemptId: string;
      listingLinkId: string | null;
      storeItemId: string | null;
    };

/**
 * Begin an import attempt for a Wix product.
 * Records the bootstrap cutoff time for order handling.
 */
export async function beginWixListingImportAttempt(
  db: WixImportAttemptDb,
  input: {
    wixConnectionId: string;
    memberId: string;
    wixProductId: string;
    wixVariantId?: string | null;
    stockMode: "PHYSICAL" | "MADE_TO_ORDER";
  }
): Promise<BeginWixListingImportAttemptResult> {
  const bootstrapStartedAt = new Date();

  // Check for existing attempt
  const existing = await db.wixListingImportAttempt.findFirst({
    where: {
      wixConnectionId: input.wixConnectionId,
      wixProductId: input.wixProductId,
    },
  });

  if (existing) {
    if (existing.status === "STARTED") {
      return { status: "ALREADY_IMPORTING", attemptId: existing.id };
    }
    if (existing.status === "COMPLETED") {
      return {
        status: "ALREADY_COMPLETED",
        attemptId: existing.id,
        listingLinkId: existing.listingLinkId,
        storeItemId: existing.storeItemId,
      };
    }
    // FAILED — reset the same row. The unique key is (connection, product).
    const reset = await db.wixListingImportAttempt.updateMany({
      where: { id: existing.id, status: "FAILED" },
      data: {
        status: "STARTED",
        memberId: input.memberId,
        wixVariantId: input.wixVariantId ?? null,
        stockMode: input.stockMode,
        bootstrapStartedAt,
        failureCode: null,
        failureMessage: null,
      },
    });
    const current = await db.wixListingImportAttempt.findUnique({ where: { id: existing.id } });
    if (!current) {
      throw new Error(`Wix import attempt disappeared: ${existing.id}`);
    }
    if (reset.count === 0) {
      if (current.status === "COMPLETED") {
        return {
          status: "ALREADY_COMPLETED",
          attemptId: current.id,
          listingLinkId: current.listingLinkId,
          storeItemId: current.storeItemId,
        };
      }
      return { status: "ALREADY_IMPORTING", attemptId: current.id };
    }
    return { status: "STARTED", attempt: current };
  }

  try {
    const attempt = await db.wixListingImportAttempt.create({
      data: {
        wixConnectionId: input.wixConnectionId,
        memberId: input.memberId,
        wixProductId: input.wixProductId,
        wixVariantId: input.wixVariantId ?? null,
        status: "STARTED",
        stockMode: input.stockMode,
        bootstrapStartedAt,
      },
    });
    return { status: "STARTED", attempt };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      // Race condition - another process started the import
      const raced = await db.wixListingImportAttempt.findFirst({
        where: {
          wixConnectionId: input.wixConnectionId,
          wixProductId: input.wixProductId,
        },
      });
      if (raced) {
        if (raced.status === "STARTED") {
          return { status: "ALREADY_IMPORTING", attemptId: raced.id };
        }
        if (raced.status === "COMPLETED") {
          return {
            status: "ALREADY_COMPLETED",
            attemptId: raced.id,
            listingLinkId: raced.listingLinkId,
            storeItemId: raced.storeItemId,
          };
        }
        if (raced.status === "FAILED") {
          return beginWixListingImportAttempt(db, input);
        }
      }
    }
    throw error;
  }
}

/**
 * Mark an import attempt as completed successfully.
 */
export async function completeWixListingImportAttempt(
  db: WixImportAttemptDb,
  input: {
    attemptId: string;
    storeItemId: string;
    listingLinkId: string;
  }
): Promise<void> {
  await db.wixListingImportAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: "COMPLETED",
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
    },
  });
}

/**
 * Mark an import attempt as failed.
 */
export async function failWixListingImportAttempt(
  db: WixImportAttemptDb,
  input: {
    attemptId: string;
    failureCode: string;
    failureMessage?: string;
  }
): Promise<void> {
  await db.wixListingImportAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: "FAILED",
      failureCode: input.failureCode.slice(0, 64),
      failureMessage: input.failureMessage?.slice(0, 2000) ?? null,
    },
  });
}

/**
 * Get the bootstrap cutoff for a listing (from import attempt or listing link).
 */
export async function getWixListingBootstrapCutoff(
  db: WixImportAttemptDb,
  input: { wixConnectionId: string; wixProductId: string }
): Promise<Date | null> {
  // First check listing link
  const link = await db.wixListingLink.findFirst({
    where: {
      wixConnectionId: input.wixConnectionId,
      wixProductId: input.wixProductId,
    },
    select: { importBootstrapStartedAt: true },
  });
  if (link?.importBootstrapStartedAt) {
    return link.importBootstrapStartedAt;
  }

  // Fall back to import attempt
  const attempt = await db.wixListingImportAttempt.findFirst({
    where: {
      wixConnectionId: input.wixConnectionId,
      wixProductId: input.wixProductId,
      status: "COMPLETED",
    },
    select: { bootstrapStartedAt: true },
  });
  return attempt?.bootstrapStartedAt ?? null;
}

/**
 * Get import attempt by ID.
 */
export async function getWixListingImportAttempt(
  db: WixImportAttemptDb,
  attemptId: string
): Promise<WixListingImportAttempt | null> {
  return db.wixListingImportAttempt.findUnique({
    where: { id: attemptId },
  });
}

/**
 * List all import attempts for a connection.
 */
export async function listWixListingImportAttempts(
  db: WixImportAttemptDb,
  wixConnectionId: string
): Promise<WixListingImportAttempt[]> {
  return db.wixListingImportAttempt.findMany({
    where: { wixConnectionId },
    orderBy: { createdAt: "desc" },
  });
}
