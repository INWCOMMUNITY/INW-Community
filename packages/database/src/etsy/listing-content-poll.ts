import type { PrismaClient } from "@prisma/client";
import { enqueueEtsySyncJob } from "./jobs";

export type EtsyPollDb = PrismaClient;

/** Match Vercel `/api/cron/etsy-sync-jobs` minutely schedule. */
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
/**
 * Keep the connection poll lease long enough that a queued POLL behind outbound
 * work is not treated as abandoned and double-enqueued.
 */
const DEFAULT_LEASE_MS = 4 * 60 * 1000;

export function etsyPollListingContentDedupeKey(connectionId: string, windowStartMs: number): string {
  return `POLL_LISTING_CONTENT:${connectionId}:${windowStartMs}`;
}

export function etsyListingContentPollWindowStartMs(nowMs: number, intervalMs: number): number {
  const safeInterval = Math.max(1, intervalMs);
  return Math.floor(nowMs / safeInterval) * safeInterval;
}

/**
 * Due once per schedule window: if we have not completed a poll since this
 * window started, enqueue. Avoids the old "now minus interval" skew that stretched
 * five-minute cron gaps to about ten minutes.
 */
export function isEtsyListingContentPollDue(input: {
  lastPolledAt: Date | null | undefined;
  windowStartMs: number;
}): boolean {
  if (input.lastPolledAt == null) return true;
  return input.lastPolledAt.getTime() < input.windowStartMs;
}

/**
 * Discover ACTIVE Etsy connections due for inbound listing content poll and enqueue jobs.
 * Advances no cursors here — the POLL_LISTING_CONTENT handler owns completion watermark.
 */
export async function enqueueDueEtsyListingContentPolls(
  db: EtsyPollDb,
  input?: { limit?: number; now?: Date; intervalMs?: number; leaseMs?: number }
): Promise<{ enqueued: number; connectionIds: string[] }> {
  const now = input?.now ?? new Date();
  const intervalMs = input?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const leaseMs = input?.leaseMs ?? DEFAULT_LEASE_MS;
  const limit = Math.max(1, Math.min(50, input?.limit ?? 20));
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const windowStartMs = etsyListingContentPollWindowStartMs(now.getTime(), intervalMs);
  const windowStart = new Date(windowStartMs);

  return db.$transaction(async (tx) => {
    const due = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM etsy_connection c
      WHERE c.status = CAST('ACTIVE' AS etsy_connection_status)
        AND (
          c.listing_content_last_polled_at IS NULL
          OR c.listing_content_last_polled_at < ${windowStart}
        )
        AND (
          c.listing_content_poll_lease_expires_at IS NULL
          OR c.listing_content_poll_lease_expires_at < ${now}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM etsy_sync_job j
          WHERE j.etsy_connection_id = c.id
            AND j.kind = CAST('POLL_LISTING_CONTENT' AS etsy_sync_job_kind)
            AND (
              j.state = CAST('PENDING' AS etsy_sync_job_state)
              OR j.state = CAST('RUNNING' AS etsy_sync_job_state)
              OR j.state = CAST('RETRY_WAIT' AS etsy_sync_job_state)
            )
        )
      ORDER BY c.listing_content_last_polled_at ASC NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE OF c SKIP LOCKED
    `;

    const connectionIds: string[] = [];
    for (const row of due) {
      await tx.etsyConnection.update({
        where: { id: row.id },
        data: { listingContentPollLeaseExpiresAt: leaseUntil },
      });
      const job = await enqueueEtsySyncJob(tx, {
        etsyConnectionId: row.id,
        kind: "POLL_LISTING_CONTENT",
        dedupeKey: etsyPollListingContentDedupeKey(row.id, windowStartMs),
        payload: { connectionId: row.id, windowStartMs },
      });
      if (job.state === "PENDING") {
        connectionIds.push(row.id);
      }
    }

    return { enqueued: connectionIds.length, connectionIds };
  });
}

export async function markEtsyListingContentPollComplete(
  db: PrismaClient,
  input: { connectionId: string; now?: Date }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.etsyConnection.updateMany({
    where: { id: input.connectionId, status: "ACTIVE" },
    data: {
      listingContentLastPolledAt: now,
      listingContentPollLeaseExpiresAt: null,
    },
  });
}
