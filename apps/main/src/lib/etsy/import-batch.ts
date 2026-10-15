import {
  appendEtsyImportBatchFailures,
  enqueueEtsySyncJob,
  etsyImportBatchDedupeKey,
  etsyImportBatchProgressView,
  findActiveEtsyImportBatch,
  nextEtsyImportBatchAvgItemMs,
  parseEtsyImportBatchQueue,
  prisma,
  type EtsyImportBatchProgressView,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { discoverEtsyImportCandidates } from "./import-discovery";
import { importEtsyListing } from "./import-listing";

type EtsyImportStockModePolicy = "RECOMMENDED" | "PHYSICAL" | "MADE_TO_ORDER";

const DISCOVER_PAGE_SIZE = 25;
const MAX_ITEMS_PER_CLAIM = 3;
const MAX_CLAIM_MS = 45_000;
const MAX_FAILURES_DETAIL = 40;

export type StartEtsyImportBatchResult =
  | { status: "STARTED" | "ALREADY_RUNNING"; batch: EtsyImportBatchProgressView }
  | { status: "ERROR"; code: string; message: string; httpStatus: number };

function parseBatchId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { batchId?: unknown }).batchId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function enqueueImportBatchJob(input: {
  connectionId: string;
  batchId: string;
  nextAttemptAt?: Date;
}): Promise<void> {
  await enqueueEtsySyncJob(prisma, {
    etsyConnectionId: input.connectionId,
    kind: "IMPORT_BATCH",
    dedupeKey: etsyImportBatchDedupeKey(input.connectionId, input.batchId),
    payload: { batchId: input.batchId },
    maxAttempts: 10_000,
    nextAttemptAt: input.nextAttemptAt ?? new Date(),
  });
}

const MAX_PRICED_LISTINGS = 5000;
const MAX_SHIPPING_CENTS = 10_000_000;

export function assignedImportShipping(input: {
  listingIds?: unknown;
  shippingPrices?: unknown;
}):
  | { ok: true; listingIds: string[]; shippingPrices: Record<string, number> }
  | { ok: false; message: string }
  | null {
  if (input.listingIds == null && input.shippingPrices == null) return null;
  if (!Array.isArray(input.listingIds) || input.listingIds.length === 0) {
    return { ok: false, message: "Choose the listings to import." };
  }
  if (input.listingIds.length > MAX_PRICED_LISTINGS) {
    return { ok: false, message: "Too many listings to price at once. Ship for free instead." };
  }
  const prices =
    input.shippingPrices && typeof input.shippingPrices === "object" && !Array.isArray(input.shippingPrices)
      ? (input.shippingPrices as Record<string, unknown>)
      : null;
  if (!prices) return { ok: false, message: "Enter a shipping price for every listing." };

  const listingIds: string[] = [];
  const seen = new Set<string>();
  const shippingPrices: Record<string, number> = {};
  for (const entry of input.listingIds) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const cents = prices[id];
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0 || cents > MAX_SHIPPING_CENTS) {
      return { ok: false, message: "Enter a shipping price for every listing." };
    }
    listingIds.push(id);
    shippingPrices[id] = cents;
  }
  if (listingIds.length === 0) return { ok: false, message: "Choose the listings to import." };
  return { ok: true, listingIds, shippingPrices };
}

function shippingCentsFromBatch(raw: unknown, etsyListingId: string): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const value = (raw as Record<string, unknown>)[etsyListingId];
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export async function startEtsyImportBatch(input: {
  memberId: string;
  stockModePolicy?: string;
  listingIds?: unknown;
  shippingPrices?: unknown;
}): Promise<StartEtsyImportBatchResult> {
  const policyRaw = (input.stockModePolicy ?? "RECOMMENDED").toString().trim().toUpperCase();
  const stockModePolicy: EtsyImportStockModePolicy =
    policyRaw === "PHYSICAL" || policyRaw === "MADE_TO_ORDER" || policyRaw === "RECOMMENDED"
      ? (policyRaw as EtsyImportStockModePolicy)
      : "RECOMMENDED";
  const assigned = assignedImportShipping({
    listingIds: input.listingIds,
    shippingPrices: input.shippingPrices,
  });
  if (assigned && !assigned.ok) {
    return { status: "ERROR", code: "INVALID_SHIPPING", message: assigned.message, httpStatus: 400 };
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Etsy before importing listings.",
      httpStatus: 409,
    };
  }

  const active = await findActiveEtsyImportBatch(prisma, connection.id);
  if (active) {
    return {
      status: "ALREADY_RUNNING",
      batch: etsyImportBatchProgressView(active),
    };
  }

  let batch;
  try {
    batch = await prisma.etsyImportBatch.create({
      data: {
        etsyConnectionId: connection.id,
        memberId: input.memberId,
        state: "PENDING",
        stockModePolicy,
        shippingPolicy: "FREE",
        shippingPricesJson: assigned?.ok ? assigned.shippingPrices : {},
        ...(assigned?.ok
          ? {
              queueJson: assigned.listingIds,
              total: assigned.listingIds.length,
              discoverComplete: true,
            }
          : {}),
        startedAt: new Date(),
        lastProgressAt: new Date(),
      },
    });
  } catch (error) {
    // Partial unique index: one PENDING/RUNNING batch per connection.
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      const raced = await findActiveEtsyImportBatch(prisma, connection.id);
      if (raced) {
        return { status: "ALREADY_RUNNING", batch: etsyImportBatchProgressView(raced) };
      }
    }
    throw error;
  }

  await enqueueImportBatchJob({
    connectionId: connection.id,
    batchId: batch.id,
  });

  return {
    status: "STARTED",
    batch: etsyImportBatchProgressView(batch),
  };
}

export async function getEtsyImportBatchStatus(input: {
  memberId: string;
}): Promise<EtsyImportBatchProgressView | null> {
  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) return null;

  const active = await findActiveEtsyImportBatch(prisma, connection.id);
  if (active) return etsyImportBatchProgressView(active);

  const latest = await prisma.etsyImportBatch.findFirst({
    where: { etsyConnectionId: connection.id, memberId: input.memberId },
    orderBy: { createdAt: "desc" },
  });
  return latest ? etsyImportBatchProgressView(latest) : null;
}

export async function cancelEtsyImportBatch(input: {
  memberId: string;
}): Promise<
  | { status: "OK"; batch: EtsyImportBatchProgressView }
  | { status: "ERROR"; code: string; message: string; httpStatus: number }
> {
  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Etsy before cancelling an import.",
      httpStatus: 409,
    };
  }

  const active = await findActiveEtsyImportBatch(prisma, connection.id);
  if (!active) {
    return {
      status: "ERROR",
      code: "NO_ACTIVE_BATCH",
      message: "No import is currently running.",
      httpStatus: 404,
    };
  }

  const updated = await prisma.etsyImportBatch.update({
    where: { id: active.id },
    data: {
      cancelRequested: true,
      lastProgressAt: new Date(),
    },
  });

  // Make the job claimable immediately even if it was waiting on RETRY_WAIT.
  await prisma.etsySyncJob.updateMany({
    where: {
      etsyConnectionId: connection.id,
      dedupeKey: etsyImportBatchDedupeKey(connection.id, updated.id),
      state: { in: ["PENDING", "RETRY_WAIT"] },
    },
    data: {
      state: "PENDING",
      nextAttemptAt: new Date(),
    },
  });

  await enqueueImportBatchJob({
    connectionId: connection.id,
    batchId: updated.id,
  }).catch(() => undefined);

  return { status: "OK", batch: etsyImportBatchProgressView(updated) };
}

async function finishBatch(
  batchId: string,
  state: "COMPLETED" | "FAILED" | "CANCELLED",
  lastError?: string | null
) {
  return prisma.etsyImportBatch.update({
    where: { id: batchId },
    data: {
      state,
      finishedAt: new Date(),
      lastProgressAt: new Date(),
      lastError: lastError ?? null,
      queueJson: [],
    },
  });
}

/**
 * IMPORT_BATCH handler — discover pages + import a few listings per claim, then re-queue.
 */
export async function handleEtsyImportBatchJob(
  claim: EtsySyncJobClaim
): Promise<EtsyJobHandlerResult> {
  const batchId = parseBatchId(claim.payload);
  if (!batchId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "IMPORT_BATCH payload is missing batchId",
    };
  }

  const batch = await prisma.etsyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "BATCH_NOT_FOUND",
      errorMessage: "Import batch was not found",
    };
  }
  if (batch.etsyConnectionId !== claim.etsyConnectionId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "BATCH_CONNECTION_MISMATCH",
      errorMessage: "Import batch does not belong to this Etsy connection",
    };
  }

  if (batch.state === "COMPLETED" || batch.state === "FAILED" || batch.state === "CANCELLED") {
    return { outcome: "SUCCESS" };
  }

  if (batch.cancelRequested) {
    await finishBatch(batch.id, "CANCELLED");
    return { outcome: "SUCCESS" };
  }

  await prisma.etsyImportBatch.update({
    where: { id: batch.id },
    data: {
      state: "RUNNING",
      startedAt: batch.startedAt ?? new Date(),
      lastProgressAt: new Date(),
    },
  });

  const claimStarted = Date.now();
  let queue = parseEtsyImportBatchQueue(batch.queueJson);
  let discoverOffset = batch.discoverOffset;
  let discoverComplete = batch.discoverComplete;
  let total = batch.total;
  let completed = batch.completed;
  let failed = batch.failed;
  let skipped = batch.skipped;
  let avgItemMs = batch.avgItemMs;
  let failures = appendEtsyImportBatchFailures(batch.failuresJson, []);
  let processedBefore = completed + failed + skipped;

  // Fill the queue from Etsy discover pages when empty.
  while (
    queue.length === 0 &&
    !discoverComplete &&
    Date.now() - claimStarted < MAX_CLAIM_MS
  ) {
    const page = await discoverEtsyImportCandidates({
      memberId: batch.memberId,
      offset: discoverOffset,
      limit: DISCOVER_PAGE_SIZE,
    });
    if (page.status === "ERROR") {
      if (page.code === "UNAUTHORIZED" || page.code === "CONNECTION_REQUIRED") {
        await finishBatch(batch.id, "FAILED", page.message);
        return {
          outcome: "DEAD",
          errorClass: "AUTH",
          errorCode: page.code,
          errorMessage: page.message,
        };
      }
      await prisma.etsyImportBatch.update({
        where: { id: batch.id },
        data: {
          lastError: page.message,
          lastProgressAt: new Date(),
        },
      });
      return {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: page.code,
        errorMessage: page.message,
        retryAt: new Date(Date.now() + 5_000),
      };
    }

    const ids = page.candidates.map((c) => c.etsyListingId).filter(Boolean);
    queue = [...queue, ...ids];
    total += ids.length;
    discoverOffset = page.pageInfo.offset;
    discoverComplete = !page.pageInfo.hasNextPage;

    await prisma.etsyImportBatch.update({
      where: { id: batch.id },
      data: {
        queueJson: queue,
        total,
        discoverOffset,
        discoverComplete,
        lastProgressAt: new Date(),
        lastError: null,
      },
    });

    if (discoverComplete) break;
    // One discover page per claim when queue stays empty after a sparse page.
    if (ids.length === 0) break;
  }

  let itemsThisClaim = 0;
  while (
    queue.length > 0 &&
    itemsThisClaim < MAX_ITEMS_PER_CLAIM &&
    Date.now() - claimStarted < MAX_CLAIM_MS
  ) {
    const latest = await prisma.etsyImportBatch.findUnique({
      where: { id: batch.id },
      select: { cancelRequested: true },
    });
    if (latest?.cancelRequested) {
      await finishBatch(batch.id, "CANCELLED");
      return { outcome: "SUCCESS" };
    }

    const etsyListingId = queue.shift()!;
    const itemStarted = Date.now();

    try {
      const result = await importEtsyListing({
        memberId: batch.memberId,
        etsyListingId,
        stockMode: batch.stockModePolicy,
        shippingCostCents: shippingCentsFromBatch(batch.shippingPricesJson, etsyListingId),
      });
      const itemMs = Date.now() - itemStarted;
      avgItemMs = nextEtsyImportBatchAvgItemMs(avgItemMs, processedBefore, itemMs);
      processedBefore += 1;

      if (result.status === "IMPORTED") {
        completed += 1;
        if (result.personalizationWarning) {
          failures = appendEtsyImportBatchFailures(failures, [
            {
              etsyListingId,
              message: `PERSONALIZATION: ${result.personalizationWarning}`.slice(0, 400),
            },
          ]);
        }
      } else if (result.status === "ALREADY_IMPORTED") {
        skipped += 1;
      } else if (result.status === "ERROR" && result.code === "IMPORT_IN_PROGRESS") {
        // Put back and try later — do not burn as failed.
        queue.unshift(etsyListingId);
        await prisma.etsyImportBatch.update({
          where: { id: batch.id },
          data: {
            queueJson: queue,
            lastProgressAt: new Date(),
            lastError: "Waiting for an in-progress listing import to finish…",
          },
        });
        return {
          outcome: "RETRY",
          errorClass: "TRANSIENT",
          errorCode: "IMPORT_IN_PROGRESS",
          errorMessage: "Waiting for an in-progress listing import to finish",
          retryAt: new Date(Date.now() + 8_000),
        };
      } else if (result.status === "ERROR") {
        failed += 1;
        failures = appendEtsyImportBatchFailures(failures, [
          {
            etsyListingId,
            message: result.message || result.code || "Import failed",
          },
        ]).slice(-MAX_FAILURES_DETAIL);
      }
    } catch (error) {
      const itemMs = Date.now() - itemStarted;
      avgItemMs = nextEtsyImportBatchAvgItemMs(avgItemMs, processedBefore, itemMs);
      processedBefore += 1;
      failed += 1;
      failures = appendEtsyImportBatchFailures(failures, [
        {
          etsyListingId,
          message:
            error instanceof Error && error.message.trim()
              ? error.message.trim().slice(0, 400)
              : "Import failed unexpectedly",
        },
      ]).slice(-MAX_FAILURES_DETAIL);
    }

    itemsThisClaim += 1;
    await prisma.etsyImportBatch.update({
      where: { id: batch.id },
      data: {
        queueJson: queue,
        completed,
        failed,
        skipped,
        avgItemMs,
        failuresJson: failures,
        lastProgressAt: new Date(),
        lastError: null,
      },
    });
  }

  const done = discoverComplete && queue.length === 0;
  if (done) {
    await finishBatch(batch.id, "COMPLETED");
    return { outcome: "SUCCESS" };
  }

  await prisma.etsyImportBatch.update({
    where: { id: batch.id },
    data: {
      queueJson: queue,
      total,
      discoverOffset,
      discoverComplete,
      completed,
      failed,
      skipped,
      avgItemMs,
      failuresJson: failures,
      lastProgressAt: new Date(),
      state: "RUNNING",
    },
  });

  // Continue immediately so inline kick / cron loops can drain more listings.
  return {
    outcome: "RETRY",
    errorClass: "TRANSIENT",
    errorCode: "IMPORT_BATCH_CONTINUE",
    errorMessage: "Import batch still has work remaining",
    retryAt: new Date(),
  };
}
