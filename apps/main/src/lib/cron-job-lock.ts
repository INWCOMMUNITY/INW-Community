import { randomUUID } from "crypto";
import { prisma } from "database";

const RELEASED_HOLDER = "";

/** Must be >= sync-channels maxDuration (300s) so a live run cannot be stolen. */
export const SYNC_CHANNELS_LOCK_TTL_MS = 320_000;

/** Per-connection inbound catalog (webhook + cron must not overlap media writes). */
export const INBOUND_CATALOG_LOCK_TTL_MS = 120_000;

export type CronLockAcquireResult =
  | { acquired: false }
  | { acquired: true; holderId: string; passStartedAt: Date; resumed: boolean };

/**
 * Exclusive lease for a named cron job. Stolen only after `ttlMs` so a timed-out
 * invocation cannot overlap the next tick. Resume keeps `passStartedAt` so
 * reconcile can skip connections already finished in this pass.
 *
 * Insert uses ON CONFLICT so overlapping Vercel ticks never throw Prisma P2002
 * (which is logged as [prisma:error] even when caught).
 */
export async function tryAcquireCronLock(
  jobName: string,
  ttlMs: number
): Promise<CronLockAcquireResult> {
  const now = new Date();
  const holderId = randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const inserted = await prisma.$executeRaw`
    INSERT INTO cron_job_lock (
      job_name,
      holder_id,
      acquired_at,
      expires_at,
      pass_started_at,
      updated_at
    )
    VALUES (
      ${jobName},
      ${holderId},
      ${now},
      ${expiresAt},
      ${now},
      ${now}
    )
    ON CONFLICT (job_name) DO NOTHING
  `;

  if (Number(inserted) === 1) {
    return {
      acquired: true,
      holderId,
      passStartedAt: now,
      resumed: false,
    };
  }

  const row = await prisma.cronJobLock.findUnique({ where: { jobName } });
  if (!row) return { acquired: false };

  const held = row.holderId !== RELEASED_HOLDER && row.expiresAt.getTime() >= now.getTime();
  if (held) return { acquired: false };

  const resume = row.holderId !== RELEASED_HOLDER && row.passStartedAt != null;
  const stolen = await prisma.cronJobLock.updateMany({
    where: {
      jobName,
      OR: [{ holderId: RELEASED_HOLDER }, { expiresAt: { lt: now } }],
    },
    data: {
      holderId,
      acquiredAt: now,
      expiresAt,
      passStartedAt: resume ? row.passStartedAt : now,
    },
  });
  if (stolen.count !== 1) return { acquired: false };
  return {
    acquired: true,
    holderId,
    passStartedAt: resume && row.passStartedAt ? row.passStartedAt : now,
    resumed: resume,
  };
}

export async function releaseCronLock(
  jobName: string,
  holderId: string,
  extras?: { durationMs?: number }
): Promise<void> {
  await prisma.cronJobLock
    .updateMany({
      where: { jobName, holderId },
      data: {
        holderId: RELEASED_HOLDER,
        expiresAt: new Date(0),
        passStartedAt: null,
        lastDurationMs: extras?.durationMs ?? null,
        lastFinishedAt: new Date(),
      },
    })
    .catch(() => {});
}

export async function readCronLock(jobName: string) {
  return prisma.cronJobLock.findUnique({ where: { jobName } });
}
