import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/sync-health
 * 
 * Health check endpoint for channel sync. Returns:
 * - Whether cron sync is enabled
 * - Recent sync activity
 * - Any connection errors
 * - Recommendations for fixing issues
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cronEnabled = process.env.CHANNEL_CRON_SYNC_ENABLED === "true";

  // Get user's connections
  const connections = await prisma.channelConnection.findMany({
    where: { memberId: userId },
    select: {
      id: true,
      provider: true,
      externalShopName: true,
      status: true,
      lastReconciledAt: true,
      lastError: true,
      config: true,
      _count: {
        select: {
          listingLinks: { where: { syncEnabled: true } },
        },
      },
    },
  });

  // Get recent sync logs (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentLogs = await prisma.channelSyncLog.groupBy({
    by: ["provider", "action"],
    where: {
      memberId: userId,
      createdAt: { gte: oneDayAgo },
    },
    _count: true,
  });

  // Get recent errors
  const recentErrors = await prisma.channelSyncLog.findMany({
    where: {
      memberId: userId,
      action: { in: ["error", "error_permanent"] },
      createdAt: { gte: oneDayAgo },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      provider: true,
      detail: true,
      createdAt: true,
    },
  });

  // Build recommendations
  const recommendations: string[] = [];

  if (!cronEnabled) {
    recommendations.push(
      "CHANNEL_CRON_SYNC_ENABLED is not set to 'true'. " +
      "The automatic sync from Etsy to INW will not run. " +
      "Use POST /api/channels/sync-now to manually trigger sync."
    );
  }

  for (const conn of connections) {
    if (conn.status === "error") {
      recommendations.push(
        `${conn.provider} connection has an error: ${conn.lastError}. ` +
        "Try reconnecting in Seller Hub → Sync Stores."
      );
    }

    const config = conn.config as Record<string, unknown> | null;
    if (conn.provider === "etsy" && !config?.defaultReadinessStateId) {
      recommendations.push(
        "Etsy connection is missing defaultReadinessStateId. " +
        "Call POST /api/channels/etsy/refresh-config to fix this."
      );
    }

    if (conn.lastReconciledAt) {
      const hoursSinceSync = (Date.now() - conn.lastReconciledAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSync > 1) {
        recommendations.push(
          `${conn.provider} hasn't synced in ${hoursSinceSync.toFixed(1)} hours. ` +
          "This might indicate a problem with the cron job."
        );
      }
    } else {
      recommendations.push(
        `${conn.provider} has never completed a sync. ` +
        "Try POST /api/channels/sync-now to trigger one."
      );
    }
  }

  // Count activity by type
  const activitySummary = recentLogs.reduce((acc, log) => {
    const key = `${log.provider}:${log.action}`;
    acc[key] = log._count;
    return acc;
  }, {} as Record<string, number>);

  return NextResponse.json({
    health: {
      cronEnabled,
      connectionsCount: connections.length,
      activeConnections: connections.filter((c) => c.status === "active").length,
      errorConnections: connections.filter((c) => c.status === "error").length,
    },
    connections: connections.map((c) => ({
      provider: c.provider,
      shopName: c.externalShopName,
      status: c.status,
      lastSyncAt: c.lastReconciledAt?.toISOString() ?? null,
      lastError: c.lastError,
      linkedItems: c._count.listingLinks,
      hasReadinessStateId: !!(c.config as Record<string, unknown> | null)?.defaultReadinessStateId,
    })),
    activityLast24h: activitySummary,
    recentErrors: recentErrors.map((e) => ({
      provider: e.provider,
      error: e.detail,
      at: e.createdAt.toISOString(),
    })),
    recommendations: recommendations.length > 0 ? recommendations : ["Sync appears healthy!"],
  });
}
