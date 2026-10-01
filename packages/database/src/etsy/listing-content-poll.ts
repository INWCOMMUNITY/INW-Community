import type { PrismaClient } from "@prisma/client";
import { enqueueEtsySyncJob } from "./jobs";

export type EtsyPollDb = PrismaClient;

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LEASE_MS = 4 * 60 * 1000;

export function etsyPollListingContentDedupeKey(connectionId: string, windowStartMs: number): string {
  return `POLL_LISTING_CONTENT:${connectionId}:${windowStartMs}`;
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
  const dueBefore = new Date(now.getTime() - intervalMs);
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const windowStartMs = Math.floor(now.getTime() / intervalMs) * intervalMs;

  return db.$transaction(async (tx) => {
    const due = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM etsy_connection
      WHERE status = CAST('ACTIVE' AS etsy_connection_status)
        AND (
          listing_content_last_polled_at IS NULL
          OR listing_content_last_polled_at <= ${dueBefore}
        )
        AND (
          listing_content_poll_lease_expires_at IS NULL
          OR listing_content_poll_lease_expires_at < ${now}
        )
      ORDER BY listing_content_last_polled_at ASC NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;

    const connectionIds: string[] = [];
    for (const row of due) {
      await tx.etsyConnection.update({
        where: { id: row.id },
        data: { listingContentPollLeaseExpiresAt: leaseUntil },
      });
      await enqueueEtsySyncJob(tx, {
        etsyConnectionId: row.id,
        kind: "POLL_LISTING_CONTENT",
        dedupeKey: etsyPollListingContentDedupeKey(row.id, windowStartMs),
        payload: { connectionId: row.id, windowStartMs },
      });
      connectionIds.push(row.id);
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
