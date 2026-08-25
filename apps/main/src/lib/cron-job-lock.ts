import { randomUUID } from "crypto";
import { prisma } from "database";

const RELEASED_HOLDER = "";

/** Must be >= sync-channels maxDuration (300s) so a live run cannot be stolen. */
export const SYNC_CHANNELS_LOCK_TTL_MS = 320_000;

export type CronLockAcquireResult =
  | { acquired: false }
  | { acquired: true; holderId: string; passStartedAt: Date; resumed: boolean };

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002");
}

/**
 * Exclusive lease for a named cron job. Stolen only after `ttlMs` so a timed-out
 * invocation cannot overlap the next tick. Resume keeps `passStartedAt` so
 * reconcile can skip connections already finished in this pass.
 */
export async function tryAcquireCronLock(
  jobName: string,
  ttlMs: number
): Promise<CronLockAcquireResult> {
  const now = new Date();
  const holderId = randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    const created = await prisma.cronJobLock.create({
      data: {
        jobName,
        holderId,
        acquiredAt: now,
        expiresAt,
        passStartedAt: now,
      },
    });
    return {
      acquired: true,
      holderId,
      passStartedAt: created.passStartedAt ?? now,
      resumed: false,
    };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }

  const stolen = await prisma.cronJobLock.updateMany({
    where: { jobName, expiresAt: { lt: now } },
    data: { holderId, acquiredAt: now, expiresAt },
  });
  if (stolen.count !== 1) return { acquired: false };

  const row = await prisma.cronJobLock.findUnique({ where: { jobName } });
  return {
    acquired: true,
    holderId,
    passStartedAt: row?.passStartedAt ?? now,
    resumed: true,
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
