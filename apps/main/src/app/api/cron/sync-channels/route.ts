import { NextRequest, NextResponse } from "next/server";
import { reconcileAllConnections } from "@/lib/channels/reconcile";
import { processRetryQueue, cleanupExhaustedRetries } from "@/lib/channels/retry-queue";
import { recoverPausedChannelConnections } from "@/lib/channels/connection";
import { shouldBlockDevChannelTokenWrites } from "@/lib/channels/dev-prod-guard";
import {
  findStaleWebhookEvents,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
  cleanupOldWebhookEvents,
} from "@/lib/channels/webhook-event";
import { reconcileMemberProvider } from "@/lib/channels/reconcile";
import { checkAllQuotaAlerts, shouldSkipSyncDueToQuota } from "@/lib/channels/daily-quota-tracker";
import { prisma } from "database";
import type { ChannelProvider } from "@/lib/channels/types";
import { tryAcquireCronLock, releaseCronLock, SYNC_CHANNELS_LOCK_TTL_MS } from "@/lib/cron-job-lock";
import { hydrateQuotaFromDb, persistQuotaToDb } from "@/lib/channels/daily-quota-tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reprocess stale pending webhook events (older than 5 minutes).
 * These are events that were logged but processing failed mid-flight.
 */
async function processStaleWebhookEvents(): Promise<{ reprocessed: number; failed: number }> {
  const stale = await findStaleWebhookEvents(20);
  let reprocessed = 0;
  let failed = 0;

  for (const event of stale) {
    try {
      await markWebhookProcessing(event.id);

      const provider = event.provider as ChannelProvider;
      const externalId = event.externalEventId;

      if (externalId) {
        const conn = await prisma.channelConnection.findFirst({
          where: {
            provider,
            OR: [
              { externalShopId: externalId },
              {
                listingLinks: {
                  some: {
                    provider,
                    OR: [
                      { externalListingId: externalId },
                      { externalShopId: externalId },
                    ],
                  },
                },
              },
            ],
            status: { not: "disconnected" },
          },
        });

        if (conn) {
          await reconcileMemberProvider(conn.memberId, provider);
        }
      }

      await markWebhookCompleted(event.id);
      reprocessed++;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("[cron] stale webhook reprocess failed", {
        eventId: event.id,
        provider: event.provider,
        error: errorMsg,
      });
      await markWebhookFailed(event.id, `Reprocess failed: ${errorMsg}`);
      failed++;
    }
  }

  return { reprocessed, failed };
}

/**
 * Channel sync cron: runs every 5 minutes to reconcile all connections.
 * 
 * Rate-limit friendly:
 * - Optimized to ~1 request per 100 listings (no per-listing API calls)
 * - 5-minute interval keeps us well under Etsy's 10,000/day limit
 * - Users get instant sync via "sync-on-view" when they open their inventory
 * 
 * Always runs reconciliation - no CHANNEL_CRON_SYNC_ENABLED check required.
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const secret = process.env.CRON_SECRET;
  
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] sync-channels starting", { timestamp: new Date().toISOString() });

  if (shouldBlockDevChannelTokenWrites()) {
    console.error(
      "[cron] refusing sync-channels: local process is using a hosted production database. Set ALLOW_PROD_DB_FROM_DEV=1 to override."
    );
    return NextResponse.json({
      ok: true,
      skipped: "dev_prod_db_guard",
    });
  }

  const lock = await tryAcquireCronLock("sync-channels", SYNC_CHANNELS_LOCK_TTL_MS);
  if (!lock.acquired) {
    console.warn("[cron] sync-channels skipped; lease held by another invocation");
    return NextResponse.json({ ok: true, skipped: "lease_held" });
  }

  try {
  await hydrateQuotaFromDb().catch(() => {});

  const recovered = await recoverPausedChannelConnections().catch((e) => {
    console.warn("[cron] paused-connection recover failed", { error: String(e) });
    return { recovered: 0, failed: 0 };
  });

  // Check quota alerts FIRST - log warnings before doing any work
  const quotaAlerts = await checkAllQuotaAlerts().catch(() => []);
  for (const alert of quotaAlerts) {
    if (alert.alertLevel === "exceeded") {
      console.error("[cron] 🚨 QUOTA EXCEEDED", alert.message);
    } else if (alert.alertLevel === "critical") {
      console.warn("[cron] ⚠️ QUOTA CRITICAL", alert.message);
    } else if (alert.alertLevel === "warning") {
      console.warn("[cron] 📊 QUOTA WARNING", alert.message);
    }
  }

  // Skip Etsy sync if quota is exhausted
  const skipEtsy = shouldSkipSyncDueToQuota("etsy");
  if (skipEtsy) {
    console.error("[cron] 🛑 Skipping Etsy sync - daily quota exhausted (>95%)");
  }

  // Process retry queue for failed pushes
  const retryResult = await processRetryQueue().catch((e) => {
    console.error("[cron] retry queue failed", { error: String(e) });
    return { processed: 0, succeeded: 0, failed: 0, exhausted: 0 };
  });
  const cleaned = await cleanupExhaustedRetries().catch(() => 0);

  // Process stale webhook events
  const webhookResult = await processStaleWebhookEvents().catch((e) => {
    console.error("[cron] stale webhook processing failed", { error: String(e) });
    return { reprocessed: 0, failed: 0 };
  });
  const webhooksCleaned = await cleanupOldWebhookEvents().catch(() => 0);

  // Run full reconciliation
  let syncResult = { connections: 0, applied: 0, imported: 0, catalogUpdated: 0, catalogRemoved: 0, metaUpdated: 0 };
  try {
    syncResult = await reconcileAllConnections({
      skipProviders: skipEtsy ? ["etsy"] : undefined,
      passStartedAt: lock.passStartedAt,
    });
    console.log("[cron] sync completed", syncResult);
  } catch (e) {
    console.error("[cron] sync failed", { error: String(e) });
    return NextResponse.json({ error: "Reconcile failed", details: String(e) }, { status: 500 });
  }

  const durationMs = Date.now() - startTime;
  if (durationMs > 240_000) {
    console.warn("[cron] sync-channels duration exceeded 240s", { durationMs });
  }
  await persistQuotaToDb().catch(() => {});
  console.log("[cron] sync-channels completed", { durationMs, resumed: lock.resumed, ...syncResult });

  return NextResponse.json({
    recoveredConnections: recovered,
    exhaustedCleaned: cleaned,
    webhookEvents: webhookResult,
    webhooksCleaned,
    ...syncResult,
    durationMs,
    resumed: lock.resumed,
    quotaAlerts: quotaAlerts.map((a) => ({
      provider: a.provider,
      level: a.alertLevel,
      message: a.message,
      usage: a.usage,
      projected: a.projected,
    })),
  });
  } finally {
    await releaseCronLock("sync-channels", lock.holderId, { durationMs: Date.now() - startTime });
  }
}
