import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { isEbayConfigured } from "@/lib/channels/ebay/config";
import { ebayGet } from "@/lib/channels/ebay/client";
import {
  fetchEbayConnectionConfig,
  optInToSellingPolicyManagement,
  readEbayConfig,
} from "@/lib/channels/ebay/account";
import { getRevisionStats } from "@/lib/channels/ebay/rate-limits";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { resetCorruptBaselinesForConnection } from "@/lib/channels/reset-corrupt-baselines";

export const dynamic = "force-dynamic";

type DiagnosisResult = {
  ok: boolean;
  verdict: string;
  summary: string;
  nextStep: string;
  connectionId?: string;
  externalShopId?: string;
  config?: {
    fulfillmentPolicyId: string | null;
    paymentPolicyId: string | null;
    returnPolicyId: string | null;
    merchantLocationKey: string | null;
    canPublish: boolean;
    sellingPolicyOptedIn: boolean;
    publishBlockReason: string | null;
    fulfillmentPolicyName: string | null;
    paymentPolicyName: string | null;
    returnPolicyName: string | null;
    merchantLocationName: string | null;
    merchantLocationEnabled: boolean;
  };
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
  revisionStats?: { sku: string; count: number; date: string }[];
  repairAttempted?: boolean;
  repairResults?: { storeItemId: string; ok: boolean; error?: string }[];
  baselineReset?: { reset: number; linkIds: string[] };
  refreshedConfig?: boolean;
};

/**
 * GET /api/channels/ebay/diagnose
 *
 * Diagnostic endpoint for troubleshooting eBay sync issues.
 * 
 * Query params:
 *   - storeItemId — focus on one linked item
 *   - repair=1 — run a sync push for linked items, then re-diagnose
 *   - resetBaseline=1 — reset poisoned syncBaselineQty values
 *   - refreshConfig=1 — re-fetch business policies and update connection config
 *   - optIn=1 — attempt to opt seller into Business Policies program
 *
 * Returns:
 *   - Token validity check
 *   - Business policies status
 *   - Merchant location status
 *   - Selling Policy Management opt-in status
 *   - Recent sync errors
 *   - Rate limit stats
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isEbayConfigured()) {
    return NextResponse.json<DiagnosisResult>({
      ok: false,
      verdict: "NOT_CONFIGURED",
      summary: "eBay is not configured on the server.",
      nextStep: "Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RUNAME in environment variables and redeploy.",
    });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json<DiagnosisResult>({
      ok: false,
      verdict: "NOT_CONNECTED",
      summary: "No eBay connection for this account.",
      nextStep: "Seller Hub → Sync Stores → Connect eBay.",
    });
  }

  const { searchParams } = new URL(req.url);
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;
  const repair = searchParams.get("repair") === "1";
  const resetBaseline = searchParams.get("resetBaseline") === "1";
  const refreshConfig = searchParams.get("refreshConfig") === "1";
  const optIn = searchParams.get("optIn") === "1";

  // Read current stored config
  let config = readEbayConfig(ctx.config);

  // Check token validity with a simple API call
  let tokenValid = false;
  let tokenError: string | undefined;
  try {
    await ebayGet(ctx.accessToken, "/sell/account/v1/privilege");
    tokenValid = true;
  } catch (e) {
    tokenError = e instanceof Error ? e.message : String(e);
  }

  // Optionally opt into Business Policies program
  if (optIn && tokenValid) {
    const optInResult = await optInToSellingPolicyManagement(ctx.accessToken);
    if (optInResult) {
      // Refresh config to pick up the change
      const freshConfig = await fetchEbayConnectionConfig(ctx.accessToken);
      await prisma.channelConnection.update({
        where: { id: ctx.id },
        data: { config: freshConfig as object },
      });
      config = freshConfig;
    }
  }

  // Optionally refresh config from eBay
  let refreshedConfig = false;
  if (refreshConfig && tokenValid) {
    const freshConfig = await fetchEbayConnectionConfig(ctx.accessToken);
    await prisma.channelConnection.update({
      where: { id: ctx.id },
      data: { config: freshConfig as object },
    });
    config = freshConfig;
    refreshedConfig = true;
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
    provider: "ebay" as const,
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
      const ebay = results.find((r) => r.provider === "ebay");
      repairResults.push({
        storeItemId: row.storeItemId,
        ok: ebay?.ok ?? results.length === 0,
        error: ebay?.error,
      });
    }
    // Re-fetch links after repair
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

  // Get revision stats
  const revisionStats = getRevisionStats().slice(0, 10);

  // Determine verdict
  let verdict: string;
  let summary: string;
  let nextStep: string;

  if (!tokenValid) {
    verdict = "TOKEN_INVALID";
    summary = `eBay access token is invalid or expired: ${tokenError}`;
    nextStep = "Disconnect and reconnect eBay in Seller Hub → Sync Stores.";
  } else if (!config.sellingPolicyOptedIn) {
    verdict = "NOT_OPTED_IN";
    summary = "Seller has not opted into eBay Business Policies program.";
    nextStep = "Visit eBay Seller Hub to opt into Business Policies, or use ?optIn=1 to attempt auto opt-in.";
  } else if (!config.canPublish) {
    verdict = "CANNOT_PUBLISH";
    summary = config.publishBlockReason || "Missing required business policies or merchant location.";
    nextStep = "Set up payment, return, and shipping policies plus enable a merchant location in eBay Seller Hub. Then use ?refreshConfig=1.";
  } else if (linkRows.length === 0) {
    verdict = "NO_LINKS";
    summary = storeItemId
      ? "No active eBay link for that item."
      : "eBay is connected but no listings are linked for sync.";
    nextStep = "Sync Stores → Import existing listings from eBay, or create new listings in INW.";
  } else if (errorCount > 0) {
    verdict = "SYNC_ERRORS";
    summary = `${errorCount} of ${links.length} linked listings have sync errors.`;
    nextStep = "Review the errors below. Use ?repair=1 to retry syncing, or ?resetBaseline=1 if baselines are corrupt.";
  } else {
    verdict = "SYNC_OK";
    summary = `eBay connection is healthy. ${links.length} listing(s) linked and syncing.`;
    nextStep = "No action needed. Use ?repair=1 to force a sync push if needed.";
  }

  return NextResponse.json<DiagnosisResult>({
    ok: verdict === "SYNC_OK",
    verdict,
    summary,
    nextStep,
    connectionId: ctx.id,
    externalShopId: ctx.externalShopId,
    config,
    tokenValid,
    tokenError,
    links,
    revisionStats: revisionStats.length > 0 ? revisionStats : undefined,
    repairAttempted: repair,
    repairResults,
    baselineReset,
    refreshedConfig,
  });
}
