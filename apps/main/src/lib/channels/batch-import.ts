/**
 * Batch import utilities for channel listings.
 * Provides progress tracking and job management for bulk import operations.
 * Jobs are persisted to the database for reliability across server restarts.
 */

import { prisma } from "database";
import { logSyncEvent } from "./sync-log";
import type { ChannelProvider } from "./types";
import type { ImportSkipEntry, ImportSuccessEntry } from "./import-skip";
import { importJobDisplayPercent } from "./import-job-progress";

export type ImportJobSnapshot = {
  externalListingId: string;
  title: string;
  sku?: string | null;
  description?: string | null;
  priceCents?: number;
  quantity?: number;
  photos?: string[];
  category?: string | null;
  subcategory?: string | null;
  remoteCategoryId?: string | null;
  shippingCostCents?: number | null;
  remoteShippingProfileId?: string | null;
  packageWeightOz?: number | null;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
  variants?: unknown;
  aspects?: { name: string; value: string }[];
  acceptOffers?: boolean;
  minOfferCents?: number | null;
  [key: string]: unknown;
};

export type ImportJobBlob = {
  listingIds?: string[];
  snapshots?: ImportJobSnapshot[];
  unmatchedIds?: string[];
  currentTitle?: string | null;
  imported?: ImportSuccessEntry[];
  skipped?: ImportSkipEntry[];
  errors?: { listingId: string; error: string }[];
};

export interface BatchImportJob {
  id: string;
  memberId: string;
  provider: ChannelProvider;
  status: "pending" | "processing" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  errors: { listingId: string; error: string }[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  currentTitle?: string | null;
  imported: ImportSuccessEntry[];
  skipped: ImportSkipEntry[];
  listingIds: string[];
  snapshots: ImportJobSnapshot[];
  unmatchedIds: string[];
}

export interface BatchImportOptions {
  skipDuplicates?: boolean;
  autoPublish?: boolean;
}

export interface BatchImportResult {
  jobId: string;
  status: "processing" | "completed";
  total: number;
  completed: number;
  failed: number;
  errors: { listingId: string; error: string }[];
  imported: { externalListingId: string; storeItemId: string }[];
}

function parseErrors(errors: unknown): { listingId: string; error: string }[] {
  if (!errors) return [];
  if (Array.isArray(errors)) {
    return errors.filter(
      (e): e is { listingId: string; error: string } =>
        typeof e === "object" && e !== null && "listingId" in e && "error" in e
    );
  }
  if (typeof errors === "object") {
    const blob = errors as ImportJobBlob;
    if (Array.isArray(blob.errors)) return parseErrors(blob.errors);
    if (Array.isArray(blob.skipped)) {
      return blob.skipped.map((s) => ({ listingId: s.externalListingId, error: s.reason }));
    }
  }
  return [];
}

export function parseImportJobBlob(errors: unknown): ImportJobBlob {
  if (!errors) {
    return { listingIds: [], snapshots: [], unmatchedIds: [], imported: [], skipped: [], errors: [] };
  }
  if (Array.isArray(errors)) {
    return {
      listingIds: [],
      snapshots: [],
      unmatchedIds: [],
      imported: [],
      skipped: [],
      errors: parseErrors(errors),
    };
  }
  if (typeof errors === "object") {
    const o = errors as ImportJobBlob;
    return {
      listingIds: Array.isArray(o.listingIds) ? o.listingIds : [],
      snapshots: Array.isArray(o.snapshots) ? o.snapshots : [],
      unmatchedIds: Array.isArray(o.unmatchedIds) ? o.unmatchedIds : [],
      currentTitle: o.currentTitle ?? null,
      imported: Array.isArray(o.imported) ? o.imported : [],
      skipped: Array.isArray(o.skipped) ? o.skipped : [],
      errors: parseErrors(o.errors ?? o.skipped),
    };
  }
  return { listingIds: [], snapshots: [], unmatchedIds: [], imported: [], skipped: [], errors: [] };
}

function dbJobToInterface(
  dbJob: {
    id: string;
    memberId: string;
    provider: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    errors: unknown;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }
): BatchImportJob {
  const blob = parseImportJobBlob(dbJob.errors);
  return {
    id: dbJob.id,
    memberId: dbJob.memberId,
    provider: dbJob.provider as ChannelProvider,
    status: dbJob.status as BatchImportJob["status"],
    total: dbJob.total,
    completed: dbJob.completed,
    failed: dbJob.failed,
    errors: blob.errors ?? [],
    createdAt: dbJob.createdAt,
    startedAt: dbJob.startedAt ?? undefined,
    completedAt: dbJob.completedAt ?? undefined,
    currentTitle: blob.currentTitle ?? null,
    imported: blob.imported ?? [],
    skipped: blob.skipped ?? [],
    listingIds: blob.listingIds ?? [],
    snapshots: blob.snapshots ?? [],
    unmatchedIds: blob.unmatchedIds ?? [],
  };
}

/**
 * Create a batch import job for tracking progress.
 */
export async function createBatchImportJob(
  memberId: string,
  provider: ChannelProvider,
  total: number,
  listingIds: string[] = []
): Promise<BatchImportJob> {
  const blob: ImportJobBlob = {
    listingIds,
    snapshots: [],
    unmatchedIds: [],
    currentTitle: null,
    imported: [],
    skipped: [],
    errors: [],
  };
  const dbJob = await prisma.batchImportJob.create({
    data: {
      memberId,
      provider,
      status: "pending",
      total,
      completed: 0,
      failed: 0,
      errors: blob as object,
    },
  });
  return dbJobToInterface(dbJob);
}

/**
 * Start processing a batch import job.
 */
export async function startBatchImportJob(jobId: string): Promise<BatchImportJob | null> {
  try {
    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: { status: "processing", startedAt: new Date() },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

/**
 * Update job progress after processing an item.
 */
export async function updateBatchImportProgress(
  jobId: string,
  success: boolean,
  error?: { listingId: string; error: string }
): Promise<BatchImportJob | null> {
  try {
    const current = await prisma.batchImportJob.findUnique({
      where: { id: jobId },
    });
    if (!current) return null;

    const blob = parseImportJobBlob(current.errors);
    const errors = blob.errors ?? [];
    if (!success && error) {
      errors.push(error);
    }
    blob.errors = errors;

    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: {
        completed: success ? current.completed + 1 : current.completed,
        failed: success ? current.failed : current.failed + 1,
        errors: blob as object,
      },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

export async function saveImportJobSnapshots(
  jobId: string,
  snapshots: ImportJobSnapshot[],
  unmatchedIds: string[] = []
): Promise<BatchImportJob | null> {
  try {
    const current = await prisma.batchImportJob.findUnique({ where: { id: jobId } });
    if (!current) return null;
    const blob = parseImportJobBlob(current.errors);
    blob.snapshots = snapshots;
    blob.unmatchedIds = unmatchedIds;
    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: { errors: blob as object },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

export async function setImportJobCurrentTitle(
  jobId: string,
  title: string | null
): Promise<BatchImportJob | null> {
  try {
    const current = await prisma.batchImportJob.findUnique({ where: { id: jobId } });
    if (!current) return null;
    const blob = parseImportJobBlob(current.errors);
    blob.currentTitle = title;
    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: { errors: blob as object },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

export async function recordImportJobItem(
  jobId: string,
  result:
    | { success: true; imported: ImportSuccessEntry }
    | { success: false; skipped: ImportSkipEntry }
): Promise<BatchImportJob | null> {
  try {
    const current = await prisma.batchImportJob.findUnique({ where: { id: jobId } });
    if (!current) return null;
    const blob = parseImportJobBlob(current.errors);
    if (result.success) {
      blob.imported = [...(blob.imported ?? []), result.imported];
    } else {
      blob.skipped = [...(blob.skipped ?? []), result.skipped];
      blob.errors = [
        ...(blob.errors ?? []),
        { listingId: result.skipped.externalListingId, error: result.skipped.reason },
      ];
    }
    blob.currentTitle = null;

    const nextCompleted = result.success ? current.completed + 1 : current.completed;
    const nextFailed = result.success ? current.failed : current.failed + 1;
    const processed = nextCompleted + nextFailed;
    const done = processed >= current.total;

    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: {
        status: done ? "completed" : current.status === "pending" ? "processing" : current.status,
        startedAt: current.startedAt ?? new Date(),
        completed: nextCompleted,
        failed: nextFailed,
        errors: blob as object,
        ...(done ? { completedAt: new Date() } : {}),
      },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

/**
 * Complete a batch import job.
 */
export async function completeBatchImportJob(jobId: string): Promise<BatchImportJob | null> {
  try {
    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: { status: "completed", completedAt: new Date() },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

/**
 * Mark a batch import job as failed.
 */
export async function failBatchImportJob(jobId: string, error: string): Promise<BatchImportJob | null> {
  try {
    const current = await prisma.batchImportJob.findUnique({
      where: { id: jobId },
    });
    const blob = parseImportJobBlob(current?.errors);
    blob.errors = [...(blob.errors ?? []), { listingId: "job", error }];

    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date(), errors: blob as object },
    });
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

/**
 * Get a batch import job by ID.
 */
export async function getBatchImportJob(jobId: string): Promise<BatchImportJob | null> {
  try {
    const dbJob = await prisma.batchImportJob.findUnique({
      where: { id: jobId },
    });
    if (!dbJob) return null;
    return dbJobToInterface(dbJob);
  } catch {
    return null;
  }
}

/**
 * Get all active jobs for a member.
 */
export async function getMemberBatchImportJobs(memberId: string): Promise<BatchImportJob[]> {
  try {
    const dbJobs = await prisma.batchImportJob.findMany({
      where: {
        memberId,
        status: { in: ["pending", "processing"] },
      },
      orderBy: { createdAt: "desc" },
    });
    return dbJobs.map(dbJobToInterface);
  } catch {
    return [];
  }
}

export function serializeBatchImportJob(job: BatchImportJob) {
  const processed = job.completed + job.failed;
  return {
    id: job.id,
    status: job.status,
    provider: job.provider,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    processed,
    errors: job.errors.slice(-20),
    progress: importJobDisplayPercent(job),
    currentTitle: job.currentTitle ?? null,
    imported: job.imported,
    skipped: job.skipped,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };
}

/**
 * Log batch import progress to ChannelSyncLog for visibility.
 */
export async function logBatchImportProgress(
  job: BatchImportJob,
  listingId: string,
  storeItemId: string | null,
  success: boolean,
  error?: string
): Promise<void> {
  logSyncEvent(
    job.memberId,
    job.provider,
    success ? "import" : "error",
    error ?? `batch ${job.completed + job.failed}/${job.total} (${listingId})`,
    storeItemId
  );
}

/**
 * Check if a listing is already linked (by external ID or title).
 */
export async function isListingAlreadyLinked(
  provider: ChannelProvider,
  connectionId: string,
  externalListingId: string,
  title?: string
): Promise<{ linked: boolean; storeItemId?: string }> {
  const existingById = await prisma.channelListingLink.findUnique({
    where: {
      provider_externalListingId: {
        provider,
        externalListingId,
      },
    },
    select: { storeItemId: true },
  });

  if (existingById) {
    return { linked: true, storeItemId: existingById.storeItemId };
  }

  if (title) {
    const existingByTitle = await prisma.channelListingLink.findFirst({
      where: {
        connectionId,
        provider,
        storeItem: {
          title: { equals: title, mode: "insensitive" },
        },
      },
      select: { storeItemId: true },
    });

    if (existingByTitle) {
      return { linked: true, storeItemId: existingByTitle.storeItemId };
    }
  }

  return { linked: false };
}

/**
 * Estimate import time based on listing count.
 */
export function estimateImportTime(listingCount: number): {
  minSeconds: number;
  maxSeconds: number;
  humanReadable: string;
} {
  const perItemMin = 0.5;
  const perItemMax = 2;

  const minSeconds = Math.ceil(listingCount * perItemMin);
  const maxSeconds = Math.ceil(listingCount * perItemMax);

  let humanReadable: string;
  if (maxSeconds < 60) {
    humanReadable = `${minSeconds}-${maxSeconds} seconds`;
  } else {
    const minMinutes = Math.ceil(minSeconds / 60);
    const maxMinutes = Math.ceil(maxSeconds / 60);
    humanReadable = `${minMinutes}-${maxMinutes} minutes`;
  }

  return { minSeconds, maxSeconds, humanReadable };
}
