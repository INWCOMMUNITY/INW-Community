import { createHash, randomBytes } from "crypto";
import type { Prisma, PrismaClient, WixSyncJob, WixSyncJobKind } from "@prisma/client";

export type WixJobDb = PrismaClient | Prisma.TransactionClient;

export class WixSyncJobConflictError extends Error {
  readonly code = "JOB_CONFLICT" as const;
  constructor(message = "Wix sync job conflict") {
    super(message);
    this.name = "WixSyncJobConflictError";
  }
}

export type EnqueueWixSyncJobInput = {
  wixConnectionId: string;
  kind: WixSyncJobKind;
  dedupeKey: string;
  evidenceId?: string | null;
  payload?: Prisma.InputJsonValue | null;
  maxAttempts?: number;
  nextAttemptAt?: Date;
};

export type WixSyncJobClaim = {
  id: string;
  wixConnectionId: string;
  kind: WixSyncJobKind;
  dedupeKey: string;
  evidenceId: string | null;
  payload: Prisma.JsonValue | null;
  payloadHash: string | null;
  state: "RUNNING";
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export type WixJobHandlerResult =
  | { outcome: "SUCCESS" }
  | {
      outcome: "RETRY";
      errorClass: string;
      errorCode?: string;
      errorMessage?: string;
      retryAt?: Date;
    }
  | {
      outcome: "DEAD";
      errorClass: string;
      errorCode?: string;
      errorMessage?: string;
    };

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export function hashWixJobPayload(payload: Prisma.InputJsonValue | null | undefined): string | null {
  if (payload === undefined || payload === null) return null;
  return createHash("sha256").update(stableJson(payload), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) out[key] = sortValue(nested);
    return out;
  }
  return value;
}

export function wixJobBackoffMs(attemptCount: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attemptCount - 1));
}

export function wixEvidenceJobDedupeKey(webhookId: string): string {
  return `PROCESS_PROVIDER_EVIDENCE:${webhookId}`;
}

export function wixUpdateListingContentDedupeKey(listingLinkId: string): string {
  return `UPDATE_LISTING_CONTENT:${listingLinkId}`;
}

export function wixProjectInventoryDedupeKey(listingLinkId: string): string {
  return `PROJECT_INVENTORY:${listingLinkId}`;
}

export function wixCreateListingDedupeKey(storeItemId: string): string {
  return `CREATE_LISTING:${storeItemId}`;
}

export function wixReconcileListingDedupeKey(listingLinkId: string): string {
  return `RECONCILE_LISTING:${listingLinkId}`;
}

export function wixPollListingContentDedupeKey(listingLinkId: string): string {
  return `POLL_LISTING_CONTENT:${listingLinkId}`;
}

/**
 * Idempotent enqueue. Same dedupeKey + same payloadHash returns existing job.
 * Same dedupeKey + different payloadHash fails closed.
 */
export async function enqueueWixSyncJob(
  db: WixJobDb,
  input: EnqueueWixSyncJobInput
): Promise<WixSyncJob> {
  const payloadHash = hashWixJobPayload(input.payload ?? null);
  const existing = await db.wixSyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) {
    if ((existing.payloadHash ?? null) === (payloadHash ?? null) && existing.kind === input.kind) {
      if (
        input.wixConnectionId === existing.wixConnectionId &&
        (input.evidenceId ?? null) === (existing.evidenceId ?? null)
      ) {
        // Resurrect sticky DEAD rows on seller retry (same dedupe/payload).
        // Also re-queue SUCCEEDED outbound mutations when desire is re-asserted.
        if (
          existing.state === "DEAD" ||
          (existing.state === "SUCCEEDED" &&
            (input.kind === "UPDATE_LISTING_CONTENT" ||
              input.kind === "PROJECT_INVENTORY" ||
              input.kind === "CREATE_LISTING" ||
              input.kind === "RECONCILE_LISTING" ||
              input.kind === "POLL_LISTING_CONTENT"))
        ) {
          return db.wixSyncJob.update({
            where: { id: existing.id },
            data: {
              state: "PENDING",
              attemptCount: 0,
              nextAttemptAt: input.nextAttemptAt ?? new Date(),
              leaseOwner: null,
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorClass: null,
              lastErrorCode: null,
              lastErrorMessage: null,
              completedAt: null,
            },
          });
        }
        // A seller reload must not wait out the previous backoff.
        if (
          input.kind === "RECONCILE_LISTING" &&
          existing.state !== "RUNNING" &&
          (existing.state === "RETRY_WAIT" || existing.nextAttemptAt > new Date())
        ) {
          return db.wixSyncJob.update({
            where: { id: existing.id },
            data: {
              state: "PENDING",
              nextAttemptAt: input.nextAttemptAt ?? new Date(),
              leaseOwner: null,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
        }
        return existing;
      }
    }
    throw new WixSyncJobConflictError();
  }

  try {
    return await db.wixSyncJob.create({
      data: {
        wixConnectionId: input.wixConnectionId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        evidenceId: input.evidenceId ?? null,
        payload: input.payload ?? undefined,
        payloadHash,
        state: "PENDING",
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: input.nextAttemptAt ?? new Date(),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      const raced = await db.wixSyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (
        raced &&
        (raced.payloadHash ?? null) === (payloadHash ?? null) &&
        raced.kind === input.kind &&
        raced.wixConnectionId === input.wixConnectionId &&
        (input.evidenceId ?? null) === (raced.evidenceId ?? null)
      ) {
        return raced;
      }
      throw new WixSyncJobConflictError();
    }
    throw error;
  }
}

/**
 * Atomically claim one due job. Commit before any handler/network work.
 * Uses FOR UPDATE SKIP LOCKED so two workers cannot own the same live lease.
 */
export async function claimNextWixSyncJob(
  db: PrismaClient,
  input: { workerId: string; leaseMs?: number; now?: Date }
): Promise<WixSyncJobClaim | null> {
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const leaseToken = randomBytes(16).toString("hex");
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM wix_sync_job
      WHERE next_attempt_at <= ${now}
        AND (
          state = CAST('PENDING' AS wix_sync_job_state)
          OR state = CAST('RETRY_WAIT' AS wix_sync_job_state)
          OR (
            state = CAST('RUNNING' AS wix_sync_job_state)
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < ${now}
          )
        )
      ORDER BY
        CASE kind
          WHEN CAST('UPDATE_LISTING_CONTENT' AS wix_sync_job_kind) THEN 0
          WHEN CAST('PROJECT_INVENTORY' AS wix_sync_job_kind) THEN 0
          WHEN CAST('CREATE_LISTING' AS wix_sync_job_kind) THEN 0
          WHEN CAST('PROCESS_PROVIDER_EVIDENCE' AS wix_sync_job_kind) THEN 1
          WHEN CAST('POLL_LISTING_CONTENT' AS wix_sync_job_kind) THEN 2
          WHEN CAST('RECONCILE_LISTING' AS wix_sync_job_kind) THEN 3
          ELSE 4
        END,
        next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) return null;

    const updated = await tx.wixSyncJob.update({
      where: { id },
      data: {
        state: "RUNNING",
        leaseOwner: input.workerId,
        leaseToken,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
      },
    });

    return {
      id: updated.id,
      wixConnectionId: updated.wixConnectionId,
      kind: updated.kind,
      dedupeKey: updated.dedupeKey,
      evidenceId: updated.evidenceId,
      payload: updated.payload,
      payloadHash: updated.payloadHash,
      state: "RUNNING",
      attemptCount: updated.attemptCount,
      maxAttempts: updated.maxAttempts,
      leaseOwner: input.workerId,
      leaseToken,
      leaseExpiresAt,
    };
  });
}

async function finalizeWithLease(
  db: WixJobDb,
  claim: Pick<WixSyncJobClaim, "id" | "leaseOwner" | "leaseToken">,
  data: Prisma.WixSyncJobUpdateManyMutationInput
): Promise<boolean> {
  const updated = await db.wixSyncJob.updateMany({
    where: {
      id: claim.id,
      leaseOwner: claim.leaseOwner,
      leaseToken: claim.leaseToken,
      state: "RUNNING",
    },
    data,
  });
  return updated.count === 1;
}

export async function completeWixSyncJobSuccess(
  db: WixJobDb,
  claim: Pick<WixSyncJobClaim, "id" | "leaseOwner" | "leaseToken">,
  now = new Date()
): Promise<boolean> {
  return finalizeWithLease(db, claim, {
    state: "SUCCEEDED",
    completedAt: now,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastErrorClass: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  });
}

export async function completeWixSyncJobDead(
  db: WixJobDb,
  claim: Pick<WixSyncJobClaim, "id" | "leaseOwner" | "leaseToken">,
  result: Extract<WixJobHandlerResult, { outcome: "DEAD" }>,
  now = new Date()
): Promise<boolean> {
  return finalizeWithLease(db, claim, {
    state: "DEAD",
    completedAt: now,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastErrorClass: result.errorClass.slice(0, 64),
    lastErrorCode: result.errorCode?.slice(0, 64) ?? null,
    lastErrorMessage: result.errorMessage?.slice(0, 2000) ?? null,
  });
}

export async function completeWixSyncJobRetry(
  db: WixJobDb,
  claim: WixSyncJobClaim,
  result: Extract<WixJobHandlerResult, { outcome: "RETRY" }>,
  now = new Date()
): Promise<boolean> {
  if (claim.attemptCount >= claim.maxAttempts) {
    return completeWixSyncJobDead(
      db,
      claim,
      {
        outcome: "DEAD",
        errorClass: result.errorClass,
        errorCode: result.errorCode ?? "MAX_ATTEMPTS",
        errorMessage: result.errorMessage ?? "Max attempts exhausted",
      },
      now
    );
  }
  const retryAt = result.retryAt ?? new Date(now.getTime() + wixJobBackoffMs(claim.attemptCount));
  return finalizeWithLease(db, claim, {
    state: "RETRY_WAIT",
    nextAttemptAt: retryAt,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastErrorClass: result.errorClass.slice(0, 64),
    lastErrorCode: result.errorCode?.slice(0, 64) ?? null,
    lastErrorMessage: result.errorMessage?.slice(0, 2000) ?? null,
  });
}
