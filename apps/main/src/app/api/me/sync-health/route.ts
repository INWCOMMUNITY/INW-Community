import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getCircuitStatus } from "@/lib/channels/circuit-breaker";

export const dynamic = "force-dynamic";

type ChannelHealth = {
  provider: string;
  status: "healthy" | "degraded" | "error" | "paused";
  circuitState: string;
  errorCount: number;
  retryQueueDepth: number;
  lastSuccessfulSync: string | null;
};

type SyncHealthResponse = {
  overall: "healthy" | "attention_needed" | "degraded";
  channels: ChannelHealth[];
  totalErrors: number;
  totalRetries: number;
  recentFailures: number;
};

/**
 * GET /api/me/sync-health
 *
 * Returns sync health status for all connected channels.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connections = await prisma.channelConnection.findMany({
    where: { memberId: userId, status: { not: "disconnected" } },
    select: {
      id: true,
      provider: true,
      status: true,
      lastError: true,
      config: true,
      _count: {
        select: {
          listingLinks: {
            where: { syncStatus: "error" },
          },
        },
      },
    },
  });

  const retryQueueDepths = await prisma.channelSyncRetry.groupBy({
    by: ["provider"],
    where: {
      link: {
        connection: { memberId: userId },
      },
    },
    _count: { id: true },
  });

  const recentLogs = await prisma.channelSyncLog.findMany({
    where: {
      memberId: userId,
      action: { in: ["push_inventory", "push_content", "error"] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: {
      provider: true,
      action: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const channelHealthMap = new Map<string, ChannelHealth>();

  for (const conn of connections) {
    const retryEntry = retryQueueDepths.find((r) => r.provider === conn.provider);
    const retryDepth = retryEntry?._count.id ?? 0;
    const errorCount = conn._count.listingLinks;

    const circuitStatus = getCircuitStatus(conn.id);

    const lastSuccess = recentLogs.find(
      (l) => l.provider === conn.provider && l.action !== "error"
    );

    let status: ChannelHealth["status"] = "healthy";
    if (circuitStatus.state === "OPEN") {
      status = "paused";
    } else if (conn.status === "error" || errorCount > 0) {
      status = "error";
    } else if (retryDepth > 0 || circuitStatus.state === "HALF_OPEN") {
      status = "degraded";
    }

    channelHealthMap.set(conn.provider, {
      provider: conn.provider,
      status,
      circuitState: circuitStatus.state,
      errorCount,
      retryQueueDepth: retryDepth,
      lastSuccessfulSync: lastSuccess?.createdAt.toISOString() ?? null,
    });
  }

  const channels = Array.from(channelHealthMap.values());
  const totalErrors = channels.reduce((sum, c) => sum + c.errorCount, 0);
  const totalRetries = channels.reduce((sum, c) => sum + c.retryQueueDepth, 0);
  const recentFailures = recentLogs.filter((l) => l.action === "error").length;

  let overall: SyncHealthResponse["overall"] = "healthy";
  if (channels.some((c) => c.status === "error" || c.status === "paused")) {
    overall = "attention_needed";
  } else if (channels.some((c) => c.status === "degraded")) {
    overall = "degraded";
  }

  return NextResponse.json<SyncHealthResponse>({
    overall,
    channels,
    totalErrors,
    totalRetries,
    recentFailures,
  });
}
