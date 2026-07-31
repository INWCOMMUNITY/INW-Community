import { NextRequest, NextResponse } from "next/server";
import { reconcileAllConnections } from "@/lib/channels/reconcile";
import { processRetryQueue, cleanupExhaustedRetries } from "@/lib/channels/retry-queue";
import {
  findStaleWebhookEvents,
  markWebhookProcessing,
  markWebhookCompleted,
  markWebhookFailed,
  cleanupOldWebhookEvents,
} from "@/lib/channels/webhook-event";
import { reconcileMemberProvider } from "@/lib/channels/reconcile";
import { prisma } from "database";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Extended to allow for two sync cycles

/** Helper to wait for a specified number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Channel sync cron: runs every minute but executes TWO sync cycles
 * (at 0s and ~30s) to achieve effective 30-second sync intervals.
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

  // Process retry queue and webhook events once at the start
  const retryResult = await processRetryQueue().catch((e) => {
    console.error("[cron] retry queue failed", { error: String(e) });
    return { processed: 0, succeeded: 0, failed: 0, exhausted: 0 };
  });
  const cleaned = await cleanupExhaustedRetries().catch(() => 0);

  const webhookResult = await processStaleWebhookEvents().catch((e) => {
    console.error("[cron] stale webhook processing failed", { error: String(e) });
    return { reprocessed: 0, failed: 0 };
  });
  const webhooksCleaned = await cleanupOldWebhookEvents().catch(() => 0);

  // FIRST SYNC CYCLE (at ~0 seconds)
  let firstSync = { connections: 0, applied: 0, imported: 0, catalogUpdated: 0, catalogRemoved: 0, metaUpdated: 0 };
  try {
    console.log("[cron] running first sync cycle");
    firstSync = await reconcileAllConnections();
    console.log("[cron] first sync cycle completed", firstSync);
  } catch (e) {
    console.error("[cron] first sync cycle failed", { error: String(e) });
  }

  // Wait ~30 seconds for second cycle
  const elapsed = Date.now() - startTime;
  const waitTime = Math.max(0, 30000 - elapsed);
  if (waitTime > 0) {
    console.log("[cron] waiting for second sync cycle", { waitMs: waitTime });
    await sleep(waitTime);
  }

  // SECOND SYNC CYCLE (at ~30 seconds)
  let secondSync = { connections: 0, applied: 0, imported: 0, catalogUpdated: 0, catalogRemoved: 0, metaUpdated: 0 };
  try {
    console.log("[cron] running second sync cycle");
    secondSync = await reconcileAllConnections();
    console.log("[cron] second sync cycle completed", secondSync);
  } catch (e) {
    console.error("[cron] second sync cycle failed", { error: String(e) });
  }

  const totalDuration = Date.now() - startTime;
  console.log("[cron] sync-channels completed", { 
    totalDurationMs: totalDuration,
    firstSync,
    secondSync,
  });

  return NextResponse.json({
    ok: true,
    retryQueue: retryResult,
    exhaustedCleaned: cleaned,
    webhookEvents: webhookResult,
    webhooksCleaned,
    syncCycles: [firstSync, secondSync],
    totalConnections: firstSync.connections,
    totalApplied: firstSync.applied + secondSync.applied,
    totalCatalogUpdated: firstSync.catalogUpdated + secondSync.catalogUpdated,
    durationMs: totalDuration,
  });
}
