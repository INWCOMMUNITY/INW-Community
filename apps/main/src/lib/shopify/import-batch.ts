import {
  appendShopifyImportBatchFailures,
  enqueueShopifySyncJob,
  findActiveShopifyImportBatch,
  nextShopifyImportBatchAvgItemMs,
  parseShopifyImportBatchQueue,
  prisma,
  resolveShopifyImportStockMode,
  shopifyImportBatchDedupeKey,
  shopifyImportBatchProgressView,
  type ShopifyImportBatchProgressView,
  type ShopifyJobHandlerResult,
  type ShopifySyncJobClaim,
} from "database";
import {
  discoverShopifyImportCandidates,
  fetchShopifyImportProductDetail,
} from "./import-discovery";
import { formatShopifyMetafieldNotice } from "./buyer-metafields";
import { importShopifyListing } from "./import-listing";

const DISCOVER_PAGE_SIZE = 25;
const MAX_ITEMS_PER_CLAIM = 2;
const MAX_CLAIM_MS = 45_000;
const MAX_FAILURES_DETAIL = 40;

type ShopifyImportStockModePolicy = "RECOMMENDED" | "PHYSICAL" | "MADE_TO_ORDER";

export type StartShopifyImportBatchResult =
  | { status: "STARTED" | "ALREADY_RUNNING"; batch: ShopifyImportBatchProgressView }
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
  await enqueueShopifySyncJob(prisma, {
    shopifyConnectionId: input.connectionId,
    kind: "IMPORT_BATCH",
    dedupeKey: shopifyImportBatchDedupeKey(input.connectionId, input.batchId),
    payload: { batchId: input.batchId },
    maxAttempts: 10_000,
    nextAttemptAt: input.nextAttemptAt ?? new Date(),
  });
}

export async function startShopifyImportBatch(input: {
  memberId: string;
  stockModePolicy?: string;
}): Promise<StartShopifyImportBatchResult> {
  const policyRaw = (input.stockModePolicy ?? "RECOMMENDED").toString().trim().toUpperCase();
  const stockModePolicy: ShopifyImportStockModePolicy =
    policyRaw === "PHYSICAL" || policyRaw === "MADE_TO_ORDER" || policyRaw === "RECOMMENDED"
      ? (policyRaw as ShopifyImportStockModePolicy)
      : "RECOMMENDED";

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, primaryLocationId: true },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Shopify before importing products.",
      httpStatus: 409,
    };
  }
  if (!connection.primaryLocationId?.trim()) {
    return {
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      message: "Set a primary Shopify location in Connection Settings before importing.",
      httpStatus: 409,
    };
  }

  const active = await findActiveShopifyImportBatch(prisma, connection.id);
  if (active) {
    return {
      status: "ALREADY_RUNNING",
      batch: shopifyImportBatchProgressView(active),
    };
  }

  let batch;
  try {
    batch = await prisma.shopifyImportBatch.create({
      data: {
        shopifyConnectionId: connection.id,
        memberId: input.memberId,
        state: "PENDING",
        stockModePolicy,
        startedAt: new Date(),
        lastProgressAt: new Date(),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      const raced = await findActiveShopifyImportBatch(prisma, connection.id);
      if (raced) {
        return { status: "ALREADY_RUNNING", batch: shopifyImportBatchProgressView(raced) };
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
    batch: shopifyImportBatchProgressView(batch),
  };
}

export async function getShopifyImportBatchStatus(input: {
  memberId: string;
}): Promise<ShopifyImportBatchProgressView | null> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) return null;

  const active = await findActiveShopifyImportBatch(prisma, connection.id);
  if (active) return shopifyImportBatchProgressView(active);

  const latest = await prisma.shopifyImportBatch.findFirst({
    where: { shopifyConnectionId: connection.id, memberId: input.memberId },
    orderBy: { createdAt: "desc" },
  });
  return latest ? shopifyImportBatchProgressView(latest) : null;
}

export async function cancelShopifyImportBatch(input: {
  memberId: string;
}): Promise<
  | { status: "OK"; batch: ShopifyImportBatchProgressView }
  | { status: "ERROR"; code: string; message: string; httpStatus: number }
> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId: input.memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return {
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      message: "Connect Shopify before cancelling an import.",
      httpStatus: 409,
    };
  }

  const active = await findActiveShopifyImportBatch(prisma, connection.id);
  if (!active) {
    return {
      status: "ERROR",
      code: "NO_ACTIVE_BATCH",
      message: "No import is currently running.",
      httpStatus: 404,
    };
  }

  const updated = await prisma.shopifyImportBatch.update({
    where: { id: active.id },
    data: {
      cancelRequested: true,
      lastProgressAt: new Date(),
    },
  });

  await prisma.shopifySyncJob.updateMany({
    where: {
      shopifyConnectionId: connection.id,
      dedupeKey: shopifyImportBatchDedupeKey(connection.id, updated.id),
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

  return { status: "OK", batch: shopifyImportBatchProgressView(updated) };
}

async function finishBatch(
  batchId: string,
  state: "COMPLETED" | "FAILED" | "CANCELLED",
  lastError?: string | null
) {
  return prisma.shopifyImportBatch.update({
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
 * IMPORT_BATCH handler — discover pages + import a few products per claim, then RETRY continue.
 */
export async function handleShopifyImportBatchJob(
  claim: ShopifySyncJobClaim
): Promise<ShopifyJobHandlerResult> {
  const batchId = parseBatchId(claim.payload);
  if (!batchId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "INVALID_PAYLOAD",
      errorMessage: "IMPORT_BATCH payload is missing batchId",
    };
  }

  const batch = await prisma.shopifyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "BATCH_NOT_FOUND",
      errorMessage: "Import batch was not found",
    };
  }
  if (batch.shopifyConnectionId !== claim.shopifyConnectionId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "BATCH_CONNECTION_MISMATCH",
      errorMessage: "Import batch does not belong to this Shopify connection",
    };
  }

  if (batch.state === "COMPLETED" || batch.state === "FAILED" || batch.state === "CANCELLED") {
    return { outcome: "SUCCESS" };
  }

  if (batch.cancelRequested) {
    await finishBatch(batch.id, "CANCELLED");
    return { outcome: "SUCCESS" };
  }

  await prisma.shopifyImportBatch.update({
    where: { id: batch.id },
    data: {
      state: "RUNNING",
      startedAt: batch.startedAt ?? new Date(),
      lastProgressAt: new Date(),
    },
  });

  const claimStarted = Date.now();
  let queue = parseShopifyImportBatchQueue(batch.queueJson);
  let discoverCursor = batch.discoverCursor;
  let discoverComplete = batch.discoverComplete;
  let total = batch.total;
  let completed = batch.completed;
  let failed = batch.failed;
  let skipped = batch.skipped;
  let avgItemMs = batch.avgItemMs;
  let failures = appendShopifyImportBatchFailures(batch.failuresJson, []);
  let processedBefore = completed + failed + skipped;

  while (
    queue.length === 0 &&
    !discoverComplete &&
    Date.now() - claimStarted < MAX_CLAIM_MS
  ) {
    const page = await discoverShopifyImportCandidates({
      memberId: batch.memberId,
      cursor: discoverCursor,
      pageSize: DISCOVER_PAGE_SIZE,
    });
    if (page.status === "ERROR") {
      if (
        page.code === "UNAUTHORIZED" ||
        page.code === "CONNECTION_REQUIRED" ||
        page.code === "LOCATION_REQUIRED"
      ) {
        await finishBatch(batch.id, "FAILED", page.message);
        return {
          outcome: "DEAD",
          errorClass: "AUTH",
          errorCode: page.code,
          errorMessage: page.message,
        };
      }
      await prisma.shopifyImportBatch.update({
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

    const ids = page.candidates
      .filter((c) => c.supported)
      .map((c) => c.shopifyProductId)
      .filter(Boolean);
    // Unsupported products count as failed discover skips so sellers see them.
    for (const unsupported of page.candidates.filter((c) => !c.supported)) {
      failed += 1;
      processedBefore += 1;
      failures = appendShopifyImportBatchFailures(failures, [
        {
          shopifyProductId: unsupported.shopifyProductId,
          message: unsupported.unsupportedReason ?? "Unsupported Shopify product",
        },
      ]).slice(-MAX_FAILURES_DETAIL);
      total += 1;
    }

    queue = [...queue, ...ids];
    total += ids.length;
    discoverCursor = page.pageInfo.endCursor;
    discoverComplete = !page.pageInfo.hasNextPage;

    await prisma.shopifyImportBatch.update({
      where: { id: batch.id },
      data: {
        queueJson: queue,
        total,
        failed,
        failuresJson: failures,
        discoverCursor,
        discoverComplete,
        lastProgressAt: new Date(),
        lastError: null,
      },
    });

    if (discoverComplete) break;
    if (ids.length === 0 && page.candidates.length === 0) break;
  }

  let itemsThisClaim = 0;
  while (
    queue.length > 0 &&
    itemsThisClaim < MAX_ITEMS_PER_CLAIM &&
    Date.now() - claimStarted < MAX_CLAIM_MS
  ) {
    const latest = await prisma.shopifyImportBatch.findUnique({
      where: { id: batch.id },
      select: { cancelRequested: true },
    });
    if (latest?.cancelRequested) {
      await finishBatch(batch.id, "CANCELLED");
      return { outcome: "SUCCESS" };
    }

    const shopifyProductId = queue.shift()!;
    const itemStarted = Date.now();
    let recommended: "PHYSICAL" | "MADE_TO_ORDER" | null = "PHYSICAL";
    if (batch.stockModePolicy === "RECOMMENDED") {
      const detail = await fetchShopifyImportProductDetail({
        memberId: batch.memberId,
        shopifyProductId,
      }).catch(() => null);
      if (detail?.status === "OK") {
        recommended = detail.candidate.recommendedStockMode;
      }
    }
    const stockMode = resolveShopifyImportStockMode(batch.stockModePolicy, recommended);

    try {
      const result = await importShopifyListing({
        memberId: batch.memberId,
        shopifyProductId,
        stockMode,
      });
      const itemMs = Date.now() - itemStarted;
      avgItemMs = nextShopifyImportBatchAvgItemMs(avgItemMs, processedBefore, itemMs);
      processedBefore += 1;

      if (result.status === "IMPORTED") {
        completed += 1;
        if (result.incompatibleMetafields?.length) {
          failures = appendShopifyImportBatchFailures(failures, [
            {
              shopifyProductId,
              message: formatShopifyMetafieldNotice(result.incompatibleMetafields),
            },
          ]).slice(-40);
        }
      } else if (result.status === "ALREADY_IMPORTED") {
        skipped += 1;
      } else if (result.status === "ERROR" && result.code === "IMPORT_IN_PROGRESS") {
        queue.unshift(shopifyProductId);
        await prisma.shopifyImportBatch.update({
          where: { id: batch.id },
          data: {
            queueJson: queue,
            lastProgressAt: new Date(),
            lastError: "Waiting for an in-progress product import to finish…",
          },
        });
        return {
          outcome: "RETRY",
          errorClass: "TRANSIENT",
          errorCode: "IMPORT_IN_PROGRESS",
          errorMessage: "Waiting for an in-progress product import to finish",
          retryAt: new Date(Date.now() + 8_000),
        };
      } else if (result.status === "ERROR") {
        failed += 1;
        failures = appendShopifyImportBatchFailures(failures, [
          {
            shopifyProductId,
            message: result.message || result.code || "Import failed",
          },
        ]).slice(-MAX_FAILURES_DETAIL);
      }
    } catch (error) {
      const itemMs = Date.now() - itemStarted;
      avgItemMs = nextShopifyImportBatchAvgItemMs(avgItemMs, processedBefore, itemMs);
      processedBefore += 1;
      failed += 1;
      failures = appendShopifyImportBatchFailures(failures, [
        {
          shopifyProductId,
          message:
            error instanceof Error && error.message.trim()
              ? error.message.trim().slice(0, 400)
              : "Import failed unexpectedly",
        },
      ]).slice(-MAX_FAILURES_DETAIL);
    }

    itemsThisClaim += 1;
    await prisma.shopifyImportBatch.update({
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

  await prisma.shopifyImportBatch.update({
    where: { id: batch.id },
    data: {
      queueJson: queue,
      total,
      discoverCursor,
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

  return {
    outcome: "RETRY",
    errorClass: "TRANSIENT",
    errorCode: "IMPORT_BATCH_CONTINUE",
    errorMessage: "Import batch still has work remaining",
    retryAt: new Date(),
  };
}
