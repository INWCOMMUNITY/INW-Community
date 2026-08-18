import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getRecentTraces, getRecentFailedTraces } from "@/lib/channels/sync-trace";
import { getErrorCategoryLabel, getSuggestedFixes } from "@/lib/channels/error-classifiers-registry";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

type TraceItem = {
  id: string;
  provider: string;
  storeItemId: string;
  operation: string;
  status: string;
  errorCode: string | null;
  errorCategory: string | null;
  errorCategoryLabel: string | null;
  rootCause: string | null;
  suggestedFixes: string[];
  durationMs: number | null;
  createdAt: string;
};

type ConnectionStatus = {
  provider: string;
  connected: boolean;
  status: string;
  lastError: string | null;
  linkedCount: number;
  errorCount: number;
};

type DiagnoseResponse = {
  ok: boolean;
  summary: string;
  connections: ConnectionStatus[];
  recentTraces: TraceItem[];
  failedTraces: TraceItem[];
  stats: {
    totalLinked: number;
    totalErrors: number;
    totalTraces: number;
    successRate: number | null;
  };
};

/**
 * GET /api/channels/diagnose
 *
 * Unified diagnostic endpoint for troubleshooting sync issues across all channels.
 * 
 * Query params:
 *   - provider — filter to a specific provider (ebay, etsy, wix, shopify)
 *   - storeItemId — focus on one item
 *   - limit — max traces to return (default 20)
 *
 * Returns:
 *   - Connection status for all providers
 *   - Recent sync traces (success and failed)
 *   - Failed traces with root cause analysis
 *   - Overall sync health stats
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const providerFilter = searchParams.get("provider")?.trim() as ChannelProvider | null;
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  // Get all connections for this member
  const connections = await prisma.channelConnection.findMany({
    where: {
      memberId: userId,
      ...(providerFilter ? { provider: providerFilter } : {}),
    },
    select: {
      id: true,
      provider: true,
      status: true,
      lastError: true,
    },
  });

  // Get linked listing counts and error counts per connection
  const connectionStats = await Promise.all(
    connections.map(async (conn) => {
      const [linked, errors] = await Promise.all([
        prisma.channelListingLink.count({
          where: { connectionId: conn.id, syncEnabled: true },
        }),
        prisma.channelListingLink.count({
          where: { connectionId: conn.id, syncEnabled: true, syncStatus: "error" },
        }),
      ]);
      return {
        provider: conn.provider,
        connected: conn.status === "active",
        status: conn.status,
        lastError: conn.lastError,
        linkedCount: linked,
        errorCount: errors,
      };
    })
  );

  // Get recent traces
  let recentTraces: TraceItem[] = [];
  let failedTraces: TraceItem[] = [];

  try {
    if (providerFilter) {
      const traces = await getRecentTraces(userId, providerFilter, {
        storeItemId: storeItemId ?? undefined,
        limit,
      });
      recentTraces = traces.map(formatTrace);
      
      const failed = await getRecentTraces(userId, providerFilter, {
        storeItemId: storeItemId ?? undefined,
        limit,
        status: "failed",
      });
      failedTraces = failed.map(formatTrace);
    } else {
      // Get traces from all providers
      const allTraces = await getRecentFailedTraces(userId, { limit });
      failedTraces = allTraces.map(formatTrace);

      // Also get recent traces from all providers
      const providers: ChannelProvider[] = ["ebay", "etsy", "wix", "shopify"];
      const allRecentTraces = await Promise.all(
        providers.map(async (p) => {
          const traces = await getRecentTraces(userId, p, { limit: 5 });
          return traces.map(formatTrace);
        })
      );
      recentTraces = allRecentTraces.flat().sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ).slice(0, limit);
    }
  } catch (e) {
    const msg = String(e);
    console.error("[channels/diagnose] failed to fetch traces", { error: msg.slice(0, 500) });
    if (msg.includes("sync_trace") || msg.includes("does not exist")) {
      return NextResponse.json(
        {
          error:
            "sync_trace table does not exist. Run database migrations (pnpm db:migrate:deploy).",
        },
        { status: 503 }
      );
    }
  }

  // Calculate stats
  const totalLinked = connectionStats.reduce((sum, c) => sum + c.linkedCount, 0);
  const totalErrors = connectionStats.reduce((sum, c) => sum + c.errorCount, 0);
  const totalTraces = recentTraces.length + failedTraces.length;
  const successCount = recentTraces.filter((t) => t.status === "success").length;
  const successRate = totalTraces > 0 ? (successCount / totalTraces) * 100 : null;

  // Determine overall status
  const hasConnections = connectionStats.some((c) => c.connected);
  const hasErrors = totalErrors > 0 || failedTraces.length > 0;
  
  let summary: string;
  if (!hasConnections) {
    summary = "No active channel connections. Connect a channel in Seller Hub > Sync Stores.";
  } else if (hasErrors) {
    summary = `${totalErrors} listing(s) have sync errors. Review the traces below for details.`;
  } else {
    summary = `All channels healthy. ${totalLinked} listing(s) linked and syncing.`;
  }

  return NextResponse.json<DiagnoseResponse>({
    ok: hasConnections && !hasErrors,
    summary,
    connections: connectionStats,
    recentTraces,
    failedTraces,
    stats: {
      totalLinked,
      totalErrors,
      totalTraces,
      successRate: successRate !== null ? Math.round(successRate * 10) / 10 : null,
    },
  });
}

function formatTrace(t: {
  id: string;
  provider: string;
  storeItemId: string;
  operation: string;
  status: string;
  errorCode: string | null;
  errorCategory: string | null;
  rootCause: string | null;
  durationMs: number | null;
  createdAt: Date;
}): TraceItem {
  return {
    id: t.id,
    provider: t.provider,
    storeItemId: t.storeItemId,
    operation: t.operation,
    status: t.status,
    errorCode: t.errorCode,
    errorCategory: t.errorCategory,
    errorCategoryLabel: t.errorCategory ? getErrorCategoryLabel(t.errorCategory) : null,
    rootCause: t.rootCause,
    suggestedFixes: getSuggestedFixes(t.errorCategory),
    durationMs: t.durationMs,
    createdAt: t.createdAt.toISOString(),
  };
}
