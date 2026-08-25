import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getPlatformSyncHealth } from "@/lib/channels/sync-health";
import { readCronLock } from "@/lib/cron-job-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET/POST /api/cron/sync-health-snapshot
 * Hourly capture of sync health metrics for trend analysis.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = await getPlatformSyncHealth();
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [staleReconcile, unmatched24h, pausedConnections, circuitOpenRows, cronLock] =
      await Promise.all([
        prisma.channelConnection.count({
          where: {
            status: { not: "disconnected" },
            OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: staleCutoff } }],
          },
        }),
        prisma.channelSyncLog.count({
          where: { action: "sale_unmatched", createdAt: { gte: since24h } },
        }),
        prisma.channelConnection.count({ where: { status: "error" } }),
        prisma.channelConnection.findMany({
          where: { status: { not: "disconnected" } },
          select: { config: true },
        }),
        readCronLock("sync-channels"),
      ]);

    let circuitOpen = 0;
    for (const row of circuitOpenRows) {
      const cfg =
        row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : null;
      const cb = cfg?.circuitBreaker as { state?: string } | undefined;
      if (cb?.state === "OPEN") circuitOpen += 1;
    }

    const lastDurationMs = cronLock?.lastDurationMs ?? null;
    const durationAlert = lastDurationMs != null && lastDurationMs > 240_000;

    const logs: Promise<unknown>[] = [];
    for (const [provider, stats] of Object.entries(health.byProvider)) {
      logs.push(
        prisma.channelSyncLog.create({
          data: {
            memberId: "system",
            provider,
            action: "health_snapshot",
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
              staleReconcile,
              unmatched24h,
              pausedConnections,
              circuitOpen,
              lastCronDurationMs: lastDurationMs,
              timestamp: new Date().toISOString(),
            }),
          },
        })
      );
    }

    await Promise.all(logs);

    const errorRate =
      health.totalConnections > 0 ? health.errorConnections / health.totalConnections : 0;

    const shouldAlert =
      errorRate > 0.1 ||
      health.errorLogs24h > 50 ||
      durationAlert ||
      staleReconcile > 0 ||
      unmatched24h > 5 ||
      circuitOpen > 0;

    if (shouldAlert) {
      console.warn("[cron/sync-health-snapshot] Degraded sync health detected!", {
        errorRate: `${Math.round(errorRate * 100)}%`,
        errorConnections: health.errorConnections,
        errorLogs24h: health.errorLogs24h,
        staleReconcile,
        unmatched24h,
        pausedConnections,
        circuitOpen,
        lastDurationMs,
      });
    }

    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.channelSyncLog.deleteMany({
      where: {
        memberId: "system",
        action: "health_snapshot",
        createdAt: { lt: cutoffDate },
      },
    });

    console.log("[cron/sync-health-snapshot]", {
      providers: Object.keys(health.byProvider).length,
      totalConnections: health.totalConnections,
      errorConnections: health.errorConnections,
      staleReconcile,
      unmatched24h,
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
        staleReconcile,
        unmatched24h,
        pausedConnections,
        circuitOpen,
        lastCronDurationMs: lastDurationMs,
      },
      snapshotsDeleted: deleted.count,
      alertTriggered: shouldAlert,
    });
  } catch (e) {
    console.error("[cron/sync-health-snapshot] error:", e);
    return NextResponse.json({ error: "Snapshot capture failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
