import { createHash, randomBytes } from "crypto";
import type { Prisma, PrismaClient, ShopifySyncJob, ShopifySyncJobKind } from "@prisma/client";

export type ShopifyJobDb = PrismaClient | Prisma.TransactionClient;

export class ShopifySyncJobConflictError extends Error {
  readonly code = "JOB_CONFLICT" as const;
  constructor(message = "Shopify sync job conflict") {
    super(message);
    this.name = "ShopifySyncJobConflictError";
  }
}

export type EnqueueShopifySyncJobInput = {
  shopifyConnectionId: string;
  kind: ShopifySyncJobKind;
  dedupeKey: string;
  evidenceId?: string | null;
  payload?: Prisma.InputJsonValue | null;
  maxAttempts?: number;
  nextAttemptAt?: Date;
};

export type ShopifySyncJobClaim = {
  id: string;
  shopifyConnectionId: string;
  kind: ShopifySyncJobKind;
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

export type ShopifyJobHandlerResult =
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

export function hashShopifyJobPayload(payload: Prisma.InputJsonValue | null | undefined): string | null {
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

export function shopifyJobBackoffMs(attemptCount: number, now = Date.now()): number {
  const exp = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attemptCount - 1));
  return Math.min(MAX_BACKOFF_MS, exp);
}

export function shopifyEvidenceJobDedupeKey(webhookId: string): string {
  return `PROCESS_PROVIDER_EVIDENCE:${webhookId}`;
}

/**
 * Idempotent enqueue. Same dedupeKey + same payloadHash returns existing job.
 * Same dedupeKey + different payloadHash fails closed.
 */
export async function enqueueShopifySyncJob(
  db: ShopifyJobDb,
  input: EnqueueShopifySyncJobInput
): Promise<ShopifySyncJob> {
  const payloadHash = hashShopifyJobPayload(input.payload ?? null);
  const existing = await db.shopifySyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) {
    if ((existing.payloadHash ?? null) === (payloadHash ?? null) && existing.kind === input.kind) {
      if (
        input.shopifyConnectionId === existing.shopifyConnectionId &&
        (input.evidenceId ?? null) === (existing.evidenceId ?? null)
      ) {
        return existing;
      }
    }
    throw new ShopifySyncJobConflictError();
  }

  try {
    return await db.shopifySyncJob.create({
      data: {
        shopifyConnectionId: input.shopifyConnectionId,
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
      const raced = await db.shopifySyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (
        raced &&
        (raced.payloadHash ?? null) === (payloadHash ?? null) &&
        raced.kind === input.kind &&
        raced.shopifyConnectionId === input.shopifyConnectionId &&
        (input.evidenceId ?? null) === (raced.evidenceId ?? null)
      ) {
        return raced;
      }
      throw new ShopifySyncJobConflictError();
    }
    throw error;
  }
}

/**
 * Atomically claim one due job. Commit before any handler/network work.
 * Uses FOR UPDATE SKIP LOCKED so two workers cannot own the same live lease.
 */
export async function claimNextShopifySyncJob(
  db: PrismaClient,
  input: { workerId: string; leaseMs?: number; now?: Date }
): Promise<ShopifySyncJobClaim | null> {
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const leaseToken = randomBytes(16).toString("hex");
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM shopify_sync_job
      WHERE next_attempt_at <= ${now}
        AND (
          state = CAST('PENDING' AS shopify_sync_job_state)
          OR state = CAST('RETRY_WAIT' AS shopify_sync_job_state)
          OR (
            state = CAST('RUNNING' AS shopify_sync_job_state)
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < ${now}
          )
        )
      ORDER BY next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) return null;

    const updated = await tx.shopifySyncJob.update({
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
      shopifyConnectionId: updated.shopifyConnectionId,
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
  db: ShopifyJobDb,
  claim: Pick<ShopifySyncJobClaim, "id" | "leaseOwner" | "leaseToken">,
  data: Prisma.ShopifySyncJobUpdateManyMutationInput
): Promise<boolean> {
  const updated = await db.shopifySyncJob.updateMany({
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

export async function completeShopifySyncJobSuccess(
  db: ShopifyJobDb,
  claim: Pick<ShopifySyncJobClaim, "id" | "leaseOwner" | "leaseToken">,
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

export async function completeShopifySyncJobRetry(
  db: ShopifyJobDb,
  claim: ShopifySyncJobClaim,
  result: Extract<ShopifyJobHandlerResult, { outcome: "RETRY" }>,
  now = new Date()
): Promise<boolean> {
  if (claim.attemptCount >= claim.maxAttempts) {
    return completeShopifySyncJobDead(db, claim, {
      outcome: "DEAD",
      errorClass: result.errorClass,
      errorCode: result.errorCode ?? "MAX_ATTEMPTS",
      errorMessage: result.errorMessage ?? "Max attempts exhausted",
    }, now);
  }
  const retryAt =
    result.retryAt ?? new Date(now.getTime() + shopifyJobBackoffMs(claim.attemptCount, now.getTime()));
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

export async function completeShopifySyncJobDead(
  db: ShopifyJobDb,
  claim: Pick<ShopifySyncJobClaim, "id" | "leaseOwner" | "leaseToken">,
  result: Extract<ShopifyJobHandlerResult, { outcome: "DEAD" }>,
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
