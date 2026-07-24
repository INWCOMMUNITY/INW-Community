import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { shopifyGet, setShopifyConnectionContext } from "@/lib/channels/shopify/client";
import { SHOPIFY_API_VERSION } from "@/lib/channels/shopify/config";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { resetCorruptBaselinesForConnection } from "@/lib/channels/reset-corrupt-baselines";
import { getCircuitStatus } from "@/lib/channels/circuit-breaker";
import { getRateLimitStats } from "@/lib/channels/rate-limit-tracker";

export const dynamic = "force-dynamic";

type DiagnosisResult = {
  ok: boolean;
  verdict: string;
  summary: string;
  nextStep: string;
  connectionId?: string;
  externalShopId?: string;
  shopName?: string;
  shopDomain?: string;
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
    burstCount?: number;
    burstLimit?: number;
  };
  repairAttempted?: boolean;
  repairResults?: { storeItemId: string; ok: boolean; error?: string }[];
  baselineReset?: { reset: number; linkIds: string[] };
};

/**
 * GET /api/channels/shopify/diagnose
 *
 * Diagnostic endpoint for troubleshooting Shopify sync issues.
 * 
 * Query params:
 *   - storeItemId — focus on one linked item
 *   - repair=1 — run a sync push for linked items, then re-diagnose
 *   - resetBaseline=1 — reset poisoned syncBaselineQty values
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

  const ctx = await getMemberConnectionContext(userId, "shopify");
  if (!ctx) {
    return NextResponse.json<DiagnosisResult>({
      ok: false,
      verdict: "NOT_CONNECTED",
      summary: "No Shopify connection for this account.",
      nextStep: "Seller Hub → Sync Stores → Connect Shopify.",
    });
  }

  if (!ctx.externalShopId) {
    return NextResponse.json<DiagnosisResult>({
      ok: false,
      verdict: "INCOMPLETE_CONNECTION",
      summary: "Shopify connection is missing shop domain.",
      nextStep: "Disconnect and reconnect Shopify in Seller Hub → Sync Stores.",
    });
  }

  setShopifyConnectionContext(ctx.id);

  const { searchParams } = new URL(req.url);
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;
  const repair = searchParams.get("repair") === "1";
  const resetBaseline = searchParams.get("resetBaseline") === "1";

  // Check token validity with a simple API call
  let tokenValid = false;
  let tokenError: string | undefined;
  let shopName: string | undefined;
  let shopDomain: string | undefined;
  try {
    const shop = await shopifyGet<{ shop: { name: string; domain: string } }>(
      ctx.accessToken,
      ctx.externalShopId,
      SHOPIFY_API_VERSION,
      "/shop.json"
    );
    shopName = shop.shop.name;
    shopDomain = shop.shop.domain;
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
    provider: "shopify" as const,
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
      const shopify = results.find((r) => r.provider === "shopify");
      repairResults.push({
        storeItemId: row.storeItemId,
        ok: shopify?.ok ?? results.length === 0,
        error: shopify?.error,
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
      provider: "shopify",
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
  const rateLimitStats = getRateLimitStats("shopify", ctx.id);
  const rateLimit = {
    currentRate: rateLimitStats.currentRate,
    limit: rateLimitStats.limit,
    percentUsed: rateLimitStats.percentUsed,
    burstCount: rateLimitStats.burstCount,
    burstLimit: rateLimitStats.burstLimit,
  };

  // Determine verdict
  let verdict: string;
  let summary: string;
  let nextStep: string;

  if (!tokenValid) {
    verdict = "TOKEN_INVALID";
    summary = `Shopify access token is invalid or expired: ${tokenError}`;
    nextStep = "Disconnect and reconnect Shopify in Seller Hub → Sync Stores.";
  } else if (circuitStatus.state === "OPEN") {
    verdict = "CIRCUIT_OPEN";
    summary = "Sync is temporarily paused due to repeated failures.";
    nextStep = "Wait for the circuit breaker to recover, or check the errors below and resolve any issues.";
  } else if (linkRows.length === 0) {
    verdict = "NO_LINKS";
    summary = storeItemId
      ? "No active Shopify link for that item."
      : "Shopify is connected but no listings are linked for sync.";
    nextStep = "Sync Stores → Import existing listings from Shopify, or create new listings in INW.";
  } else if (errorCount > 0) {
    verdict = "SYNC_ERRORS";
    summary = `${errorCount} of ${links.length} linked listings have sync errors.`;
    nextStep = "Review the errors below. Use ?repair=1 to retry syncing, or ?resetBaseline=1 if baselines are corrupt.";
  } else {
    verdict = "SYNC_OK";
    summary = `Shopify connection is healthy. ${links.length} listing(s) linked and syncing.`;
    nextStep = "No action needed. Use ?repair=1 to force a sync push if needed.";
  }

  return NextResponse.json<DiagnosisResult>({
    ok: verdict === "SYNC_OK",
    verdict,
    summary,
    nextStep,
    connectionId: ctx.id,
    externalShopId: ctx.externalShopId ?? undefined,
    shopName,
    shopDomain,
    tokenValid,
    tokenError,
    links,
    recentErrors: recentErrors.length > 0 ? recentErrors : undefined,
    circuitBreaker,
    rateLimit,
    repairAttempted: repair,
    repairResults,
    baselineReset,
  });
}
