import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getPlatformSyncHealth } from "@/lib/channels/sync-health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron secret for authentication
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/sync-health-snapshot
 *
 * Hourly capture of sync health metrics for trend analysis.
 * Stores snapshot in ChannelSyncLog for historical tracking.
 *
 * Run via cron: 0 * * * * (every hour)
 */
export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get current platform health
    const health = await getPlatformSyncHealth();

    // Log snapshot for each provider
    const logs: Promise<unknown>[] = [];

    for (const [provider, stats] of Object.entries(health.byProvider)) {
      logs.push(
        prisma.channelSyncLog.create({
          data: {
            memberId: "system", // System-level snapshot
            provider,
            action: "health_snapshot" as "error", // Using error as a catch-all; ideally extend enum
            detail: JSON.stringify({
              connections: stats.connections,
              errors: stats.errors,
              totalConnections: health.totalConnections,
              healthyConnections: health.healthyConnections,
              warningConnections: health.warningConnections,
              errorConnections: health.errorConnections,
              totalLinkedItems: health.totalLinkedItems,
              itemsWithErrors: health.itemsWithErrors,
              errorLogs24h: health.errorLogs24h,
              timestamp: new Date().toISOString(),
            }),
          },
        })
      );
    }

    await Promise.all(logs);

    // Check for degraded health and potentially send alerts
    const errorRate = health.totalConnections > 0 
      ? health.errorConnections / health.totalConnections 
      : 0;
    
    const shouldAlert = errorRate > 0.1 || health.errorLogs24h > 50;

    if (shouldAlert) {
      console.warn("[cron/sync-health-snapshot] Degraded sync health detected!", {
        errorRate: `${Math.round(errorRate * 100)}%`,
        errorConnections: health.errorConnections,
        errorLogs24h: health.errorLogs24h,
      });
      // TODO: Integrate with notification system (email, Slack, etc.)
    }

    // Clean up old snapshots (older than 30 days)
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.channelSyncLog.deleteMany({
      where: {
        memberId: "system",
        action: "health_snapshot" as "error",
        createdAt: { lt: cutoffDate },
      },
    });

    console.log("[cron/sync-health-snapshot]", {
      providers: Object.keys(health.byProvider).length,
      totalConnections: health.totalConnections,
      errorConnections: health.errorConnections,
      snapshotsDeleted: deleted.count,
      alertTriggered: shouldAlert,
    });

    return NextResponse.json({
      ok: true,
      health: {
        totalConnections: health.totalConnections,
        healthyConnections: health.healthyConnections,
        warningConnections: health.warningConnections,
        errorConnections: health.errorConnections,
        errorLogs24h: health.errorLogs24h,
      },
      snapshotsDeleted: deleted.count,
      alertTriggered: shouldAlert,
    });
  } catch (e) {
    console.error("[cron/sync-health-snapshot] error:", e);
    return NextResponse.json(
      { error: "Snapshot capture failed" },
      { status: 500 }
    );
  }
}

// GET also supported for manual trigger in dev
export async function GET(req: NextRequest) {
  return POST(req);
}
