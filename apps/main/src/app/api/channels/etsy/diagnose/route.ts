import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getEtsyConfig } from "@/lib/channels/etsy/config";
import { etsyGet, setEtsyConnectionContext } from "@/lib/channels/etsy/client";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { resetCorruptBaselinesForConnection } from "@/lib/channels/reset-corrupt-baselines";
import { getCircuitStatus, hydrateCircuitFromConfig, resetCircuit } from "@/lib/channels/circuit-breaker";
import { getRateLimitStats } from "@/lib/channels/rate-limit-tracker";
import { getRecentTraces } from "@/lib/channels/sync-trace";
import { getErrorCategoryLabel, getSuggestedFixes } from "@/lib/channels/error-classifiers-registry";

export const dynamic = "force-dynamic";

type RecentTrace = {
  id: string;
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

type DiagnosisResult = {
  ok: boolean;
  verdict: string;
  summary: string;
  nextStep: string;
  connectionId?: string;
  externalShopId?: string;
  shopName?: string;
  tokenValid?: boolean;
  tokenError?: string;
  links?: {
    storeItemId: string;
    externalListingId: string;
    title: string;
    inwQuantity: number;
    syncStatus: string;
    syncError: string | null;
    lastPushedAt: string | null;
  }[];
  recentErrors?: { action: string; detail: string; createdAt: string }[];
  circuitBreaker?: {
    state: string;
    failures: number;
    lastFailure: string | null;
    openedAt: string | null;
  };
  rateLimit?: {
    currentRate: number;
    limit: number;
    percentUsed: number;
  };
  repairAttempted?: boolean;
  repairResults?: { storeItemId: string; ok: boolean; error?: string }[];
  baselineReset?: { reset: number; linkIds: string[] };
  circuitReset?: boolean;
  recentTraces?: RecentTrace[];
};

/**
 * GET /api/channels/etsy/diagnose
 *
 * Diagnostic endpoint for troubleshooting Etsy sync issues.
 * 
 * Query params:
 *   - storeItemId — focus on one linked item
 *   - repair=1 — run a sync push for linked items, then re-diagnose
 *   - resetBaseline=1 — reset poisoned syncBaselineQty values
 *   - resetCircuit=1 — clear the “temporarily paused” circuit so Etsy pushes run again
 *
 * Returns:
 *   - Token validity check
 *   - Shop status
 *   - Recent sync errors
 *   - Circuit breaker state
 *   - Rate limit usage
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { apiKey } = getEtsyConfig();
  if (!apiKey) {
    return NextResponse.json<DiagnosisResult>({
      ok: false,
      verdict: "NOT_CONFIGURED",
      summary: "Etsy is not configured on the server.",
      nextStep: "Set ETSY_API_KEY and ETSY_SHARED_SECRET in environment variables and redeploy.",
    });
  }

  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) {
    return NextResponse.json<DiagnosisResult>({
      ok: false,
      verdict: "NOT_CONNECTED",
      summary: "No Etsy connection for this account.",
      nextStep: "Seller Hub → Sync Stores → Connect Etsy.",
    });
  }

  setEtsyConnectionContext(ctx.id);

  const { searchParams } = new URL(req.url);
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;
  const repair = searchParams.get("repair") === "1";
  const resetBaseline = searchParams.get("resetBaseline") === "1";
  const resetCircuitParam = searchParams.get("resetCircuit") === "1";

  hydrateCircuitFromConfig(ctx.id, ctx.config);
  let circuitReset = false;
  if (resetCircuitParam) {
    await resetCircuit(ctx.id, "etsy", userId);
    circuitReset = true;
  }

  // Check token validity with a simple API call
  let tokenValid = false;
  let tokenError: string | undefined;
  let shopName: string | undefined;
  try {
    const me = await etsyGet<{ user_id: number; shop_id?: number }>(
      ctx.accessToken,
      "/users/me"
    );
    if (me.shop_id && ctx.externalShopId) {
      const shop = await etsyGet<{ shop_name?: string }>(
        ctx.accessToken,
        `/shops/${ctx.externalShopId}`
      );
      shopName = shop.shop_name;
    }
    tokenValid = true;
  } catch (e) {
    tokenError = e instanceof Error ? e.message : String(e);
  }

  // Reset corrupt baselines if requested
  let baselineReset: { reset: number; linkIds: string[] } | undefined;
  if (resetBaseline) {
    baselineReset = await resetCorruptBaselinesForConnection({
      connectionId: ctx.id,
      memberId: userId,
    });
  }

  // Build link query
  const linkWhere = {
    connectionId: ctx.id,
    provider: "etsy" as const,
    syncEnabled: true,
    ...(storeItemId ? { storeItemId } : {}),
    storeItem: { memberId: userId },
  };

  // Fetch linked items
  const linkRows = await prisma.channelListingLink.findMany({
    where: linkWhere,
    select: {
      storeItemId: true,
      externalListingId: true,
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      syncBaselineQty: true,
      storeItem: {
        select: { title: true, quantity: true, status: true },
      },
    },
    take: 25,
    orderBy: { updatedAt: "desc" },
  });

  // Repair if requested
  let repairResults: { storeItemId: string; ok: boolean; error?: string }[] | undefined;
  if (repair && linkRows.length > 0) {
    repairResults = [];
    for (const row of linkRows) {
      const results = await syncInventoryToChannels(row.storeItemId);
      const etsy = results.find((r) => r.provider === "etsy");
      repairResults.push({
        storeItemId: row.storeItemId,
        ok: etsy?.ok ?? results.length === 0,
        error: etsy?.error,
      });
    }
    const refreshedLinks = await prisma.channelListingLink.findMany({
      where: linkWhere,
      select: {
        storeItemId: true,
        externalListingId: true,
        syncStatus: true,
        syncError: true,
        lastPushedAt: true,
        syncBaselineQty: true,
        storeItem: {
          select: { title: true, quantity: true, status: true },
        },
      },
      take: 25,
      orderBy: { updatedAt: "desc" },
    });
    linkRows.length = 0;
    linkRows.push(...refreshedLinks);
  }

  // Format links for response
  const links = linkRows.map((row) => ({
    storeItemId: row.storeItemId,
    externalListingId: row.externalListingId,
    title: row.storeItem.title,
    inwQuantity: row.storeItem.quantity,
    syncStatus: row.syncStatus,
    syncError: row.syncError,
    lastPushedAt: row.lastPushedAt?.toISOString() ?? null,
  }));

  // Count errors
  const errorCount = links.filter((l) => l.syncStatus === "error").length;

  // Get recent sync errors from log
  const recentErrorRows = await prisma.channelSyncLog.findMany({
    where: {
      memberId: userId,
      provider: "etsy",
      action: { in: ["error", "error_permanent", "retry_exhausted"] },
    },
    select: {
      action: true,
      detail: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const recentErrors = recentErrorRows.map((row) => ({
    action: row.action,
    detail: row.detail ?? "",
    createdAt: row.createdAt.toISOString(),
  }));

  // Get circuit breaker status
  const circuitStatus = getCircuitStatus(ctx.id);
  const circuitBreaker = {
    state: circuitStatus.state,
    failures: circuitStatus.failures,
    lastFailure: circuitStatus.lastFailure?.toISOString() ?? null,
    openedAt: circuitStatus.openedAt?.toISOString() ?? null,
  };

  // Get rate limit stats
  const rateLimitStats = getRateLimitStats("etsy", ctx.id);
  const rateLimit = {
    currentRate: rateLimitStats.currentRate,
    limit: rateLimitStats.limit,
    percentUsed: rateLimitStats.percentUsed,
  };

  // Determine verdict
  let verdict: string;
  let summary: string;
  let nextStep: string;

  if (!tokenValid) {
    verdict = "TOKEN_INVALID";
    summary = `Etsy access token is invalid or expired: ${tokenError}`;
    nextStep = "Disconnect and reconnect Etsy in Seller Hub → Sync Stores.";
  } else if (circuitStatus.state === "OPEN") {
    verdict = "CIRCUIT_OPEN";
    summary = "Sync is temporarily paused due to repeated failures.";
    nextStep =
      "Use Sync Now in Seller Hub, or open this diagnose URL with ?resetCircuit=1 after deploying the latest fix.";
  } else if (linkRows.length === 0) {
    verdict = "NO_LINKS";
    summary = storeItemId
      ? "No active Etsy link for that item."
      : "Etsy is connected but no listings are linked for sync.";
    nextStep = "Sync Stores → Import existing listings from Etsy, or create new listings in INW.";
  } else if (errorCount > 0) {
    verdict = "SYNC_ERRORS";
    summary = `${errorCount} of ${links.length} linked listings have sync errors.`;
    nextStep = "Review the errors below. Use ?repair=1 to retry syncing, or ?resetBaseline=1 if baselines are corrupt.";
  } else {
    verdict = "SYNC_OK";
    summary = `Etsy connection is healthy. ${links.length} listing(s) linked and syncing.`;
    nextStep = "No action needed. Use ?repair=1 to force a sync push if needed.";
  }

  // Fetch recent sync traces
  let recentTraces: RecentTrace[] | undefined;
  try {
    const traces = await getRecentTraces(userId, "etsy", {
      storeItemId: storeItemId ?? undefined,
      limit: 10,
    });
    if (traces.length > 0) {
      recentTraces = traces.map((t) => ({
        id: t.id,
        operation: t.operation,
        status: t.status,
        errorCode: t.errorCode,
        errorCategory: t.errorCategory,
        errorCategoryLabel: t.errorCategory ? getErrorCategoryLabel(t.errorCategory) : null,
        rootCause: t.rootCause,
        suggestedFixes: getSuggestedFixes(t.errorCategory),
        durationMs: t.durationMs,
        createdAt: t.createdAt.toISOString(),
      }));
    }
  } catch (e) {
    console.warn("[etsy/diagnose] failed to fetch traces", { error: String(e) });
  }

  return NextResponse.json<DiagnosisResult>({
    ok: verdict === "SYNC_OK",
    verdict,
    summary,
    nextStep,
    connectionId: ctx.id,
    externalShopId: ctx.externalShopId ?? undefined,
    shopName,
    tokenValid,
    tokenError,
    links,
    recentErrors: recentErrors.length > 0 ? recentErrors : undefined,
    circuitBreaker,
    rateLimit,
    repairAttempted: repair,
    repairResults,
    baselineReset,
    circuitReset,
    recentTraces,
  });
}
