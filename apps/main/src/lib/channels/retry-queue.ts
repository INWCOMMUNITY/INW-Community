import { prisma } from "database";
import { syncInventoryToChannels } from "./sync-inventory";
import { updateStoreItemOnChannels } from "./outbound";
import { classifyError, type ErrorClassification } from "./error-classifier";
import { logSyncEvent } from "./sync-log";
import type { ChannelProvider } from "./types";

const BACKOFF_SCHEDULE_MS = [
  30_000,        // 30s
  2 * 60_000,    // 2m
  10 * 60_000,   // 10m
  60 * 60_000,   // 1h
  6 * 60 * 60_000, // 6h
];

const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length;

function nextRetryDelay(attempt: number): number {
  return BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)];
}

export type RetryType = "inventory" | "content" | "publish";

/**
 * Enqueue a failed sync for automatic retry with exponential backoff.
 * Uses error classification to determine if the error should be retried.
 * - Transient errors: enqueue for retry with backoff
 * - Auth errors: enqueue for retry (token refresh happens on next attempt)
 * - Permanent errors: skip retry, log as permanent failure
 *
 * Upserts on (linkId, retryType) so duplicate enqueues for the same failure just
 * bump the schedule instead of creating duplicates.
 */
export async function enqueueRetry(
  linkId: string,
  storeItemId: string,
  provider: string,
  retryType: RetryType,
  error?: string,
  rawError?: unknown
): Promise<{ enqueued: boolean; classification: ErrorClassification }> {
  const classification = classifyError(rawError ?? error);

  if (classification === "permanent") {
    const link = await prisma.channelListingLink.findUnique({
      where: { id: linkId },
      include: { connection: { select: { memberId: true } } },
    });
    if (link) {
      logSyncEvent(
        link.connection.memberId,
        provider,
        "error_permanent",
        `Permanent error (won't retry): ${error?.slice(0, 500) ?? "Unknown error"}`,
        storeItemId
      );
    }
    return { enqueued: false, classification };
  }

  const existing = await prisma.channelSyncRetry.findFirst({
    where: { linkId, retryType },
  });

  if (existing) {
    if (existing.attempts >= MAX_ATTEMPTS) {
      return { enqueued: false, classification };
    }
    await prisma.channelSyncRetry.update({
      where: { id: existing.id },
      data: {
        lastError: error?.slice(0, 500) ?? existing.lastError,
        nextRetryAt: new Date(Date.now() + nextRetryDelay(existing.attempts)),
      },
    });
    return { enqueued: true, classification };
  }

  await prisma.channelSyncRetry.create({
    data: {
      linkId,
      storeItemId,
      provider,
      retryType,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextRetryAt: new Date(Date.now() + nextRetryDelay(0)),
      lastError: error?.slice(0, 500) ?? null,
    },
  });
  return { enqueued: true, classification };
}

/**
 * Attempt to refresh a connection's token before retrying an auth error.
 */
async function attemptTokenRefresh(
  connectionId: string,
  provider: ChannelProvider
): Promise<boolean> {
  try {
    const { refreshConnectionToken } = await import("./connection");
    await refreshConnectionToken(connectionId, provider);
    return true;
  } catch (e) {
    console.warn("[retry-queue] token refresh failed", {
      connectionId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * Process the retry queue: find due retries, attempt sync, delete on success,
 * bump attempt + nextRetryAt on failure. Uses error classification to handle
 * different error types appropriately. Called by the cron route.
 */
export async function processRetryQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  exhausted: number;
  permanent: number;
}> {
  const due = await prisma.channelSyncRetry.findMany({
    where: {
      nextRetryAt: { lte: new Date() },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { nextRetryAt: "asc" },
    take: 50,
    include: {
      link: {
        include: {
          connection: { select: { id: true, memberId: true } },
        },
      },
    },
  });

  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;
  let permanent = 0;

  for (const retry of due) {
    const provider = retry.provider as ChannelProvider;
    const memberId = retry.link?.connection?.memberId;
    const connectionId = retry.link?.connection?.id;

    try {
      if (retry.retryType === "inventory") {
        const results = await syncInventoryToChannels(retry.storeItemId);
        const providerResult = results.find((r) => r.provider === retry.provider);
        if (providerResult && !providerResult.ok) {
          throw new Error(providerResult.error ?? "Sync failed");
        }
      } else if (retry.retryType === "content") {
        const results = await updateStoreItemOnChannels(retry.storeItemId);
        const providerResult = results.find((r) => r.provider === retry.provider);
        if (providerResult && !providerResult.ok) {
          throw new Error(providerResult.error ?? "Update failed");
        }
      }

      await prisma.channelSyncRetry.delete({ where: { id: retry.id } });
      succeeded++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const classification = classifyError(e);
      const nextAttempt = retry.attempts + 1;

      if (classification === "permanent") {
        await prisma.channelSyncRetry.delete({ where: { id: retry.id } });
        permanent++;
        if (memberId) {
          logSyncEvent(
            memberId,
            provider,
            "error_permanent",
            `Permanent error after ${retry.attempts} attempts: ${msg.slice(0, 400)}`,
            retry.storeItemId
          );
        }
        console.error("[channels] retry hit permanent error", {
          linkId: retry.linkId,
          provider,
          retryType: retry.retryType,
          attempts: retry.attempts,
          error: msg,
        });
        continue;
      }

      if (classification === "auth" && connectionId) {
        const refreshed = await attemptTokenRefresh(connectionId, provider);
        if (refreshed) {
          await prisma.channelSyncRetry.update({
            where: { id: retry.id },
            data: {
              lastError: `Auth error - token refreshed, will retry: ${msg.slice(0, 400)}`,
              nextRetryAt: new Date(Date.now() + 5000),
            },
          });
          failed++;
          continue;
        }
      }

      if (nextAttempt >= MAX_ATTEMPTS) {
        await prisma.channelSyncRetry.update({
          where: { id: retry.id },
          data: {
            attempts: nextAttempt,
            lastError: msg.slice(0, 500),
          },
        });
        exhausted++;
        console.error("[channels] retry exhausted", {
          linkId: retry.linkId,
          provider,
          retryType: retry.retryType,
          attempts: nextAttempt,
          lastError: msg,
        });
      } else {
        await prisma.channelSyncRetry.update({
          where: { id: retry.id },
          data: {
            attempts: nextAttempt,
            lastError: msg.slice(0, 500),
            nextRetryAt: new Date(Date.now() + nextRetryDelay(nextAttempt)),
          },
        });
        failed++;
      }
    }
  }

  return { processed: due.length, succeeded, failed, exhausted, permanent };
}

/**
 * Clean up expired retries that have exceeded max attempts (older than 24h past last retry).
 * Logs each exhausted retry to ChannelSyncLog and sends push notification to sellers.
 */
export async function cleanupExhaustedRetries(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);

  const exhausted = await prisma.channelSyncRetry.findMany({
    where: {
      attempts: { gte: MAX_ATTEMPTS },
      createdAt: { lt: cutoff },
    },
    include: {
      link: {
        include: {
          connection: { select: { memberId: true } },
          storeItem: { select: { title: true } },
        },
      },
    },
    take: 100,
  });

  if (exhausted.length === 0) return 0;

  const memberNotifications = new Map<string, string[]>();

  for (const retry of exhausted) {
    const memberId = retry.link?.connection?.memberId;
    const provider = retry.provider;
    const itemTitle = retry.link?.storeItem?.title ?? "Unknown item";

    if (memberId) {
      logSyncEvent(
        memberId,
        provider,
        "retry_exhausted",
        `Failed after ${retry.attempts} attempts: ${retry.lastError?.slice(0, 400) ?? "Unknown error"}. Item: ${itemTitle}`,
        retry.storeItemId
      );

      const existing = memberNotifications.get(memberId) ?? [];
      existing.push(`${itemTitle} (${provider})`);
      memberNotifications.set(memberId, existing);
    }
  }

  for (const [memberId, items] of memberNotifications) {
    import("@/lib/send-push-notification")
      .then(({ sendPushNotification }) => {
        const itemList = items.slice(0, 3).join(", ");
        const more = items.length > 3 ? ` and ${items.length - 3} more` : "";
        sendPushNotification(memberId, {
          title: "Channel sync issues need attention",
          body: `${itemList}${more} failed to sync after multiple retries. Check Sync Activity for details.`,
          data: { screen: "seller-hub/channels/sync-activity" },
          category: "commerce",
        }).catch(() => {});
      })
      .catch(() => {});
  }

  const ids = exhausted.map((r) => r.id);
  const result = await prisma.channelSyncRetry.deleteMany({
    where: { id: { in: ids } },
  });

  return result.count;
}
