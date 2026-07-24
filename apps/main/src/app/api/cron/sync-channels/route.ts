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
export const maxDuration = 60;

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
 * Channel sync cron: always processes the retry queue for failed pushes,
 * reprocesses stale webhook events, and optionally runs full reconcile
 * when CHANNEL_CRON_SYNC_ENABLED=true.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (process.env.CHANNEL_CRON_SYNC_ENABLED !== "true") {
    return NextResponse.json({
      ok: true,
      retryQueue: retryResult,
      exhaustedCleaned: cleaned,
      webhookEvents: webhookResult,
      webhooksCleaned,
      reconcile: "skipped (CHANNEL_CRON_SYNC_ENABLED not set)",
    });
  }

  try {
    const result = await reconcileAllConnections();
    return NextResponse.json({
      ok: true,
      retryQueue: retryResult,
      exhaustedCleaned: cleaned,
      webhookEvents: webhookResult,
      webhooksCleaned,
      ...result,
    });
  } catch (e) {
    console.error("[cron] sync-channels failed", { error: String(e) });
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}
