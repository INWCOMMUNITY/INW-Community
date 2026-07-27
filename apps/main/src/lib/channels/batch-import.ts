/**
 * Batch import utilities for channel listings.
 * Provides progress tracking and job management for bulk import operations.
 * Jobs are persisted to the database for reliability across server restarts.
 */

import { prisma } from "database";
import { logSyncEvent, type SyncLogAction } from "./sync-log";
import type { ChannelProvider } from "./types";

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
  return [];
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
  return {
    id: dbJob.id,
    memberId: dbJob.memberId,
    provider: dbJob.provider as ChannelProvider,
    status: dbJob.status as BatchImportJob["status"],
    total: dbJob.total,
    completed: dbJob.completed,
    failed: dbJob.failed,
    errors: parseErrors(dbJob.errors),
    createdAt: dbJob.createdAt,
    startedAt: dbJob.startedAt ?? undefined,
    completedAt: dbJob.completedAt ?? undefined,
  };
}

/**
 * Create a batch import job for tracking progress.
 */
export async function createBatchImportJob(
  memberId: string,
  provider: ChannelProvider,
  total: number
): Promise<BatchImportJob> {
  const dbJob = await prisma.batchImportJob.create({
    data: {
      memberId,
      provider,
      status: "pending",
      total,
      completed: 0,
      failed: 0,
      errors: [],
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

    const errors = parseErrors(current.errors);
    if (!success && error) {
      errors.push(error);
    }

    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: {
        completed: success ? current.completed + 1 : current.completed,
        failed: success ? current.failed : current.failed + 1,
        errors,
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
    const errors = parseErrors(current?.errors);
    errors.push({ listingId: "job", error });

    const dbJob = await prisma.batchImportJob.update({
      where: { id: jobId },
      data: { status: "failed", completedAt: new Date(), errors },
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
