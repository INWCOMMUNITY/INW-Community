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
import { readEbayWebhookReceipt } from "@/lib/channels/ebay/notifications-setup";
import { ebayWebhookUrlIsSecured } from "@/lib/channels/ebay/webhook";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { resetCorruptBaselinesForConnection } from "@/lib/channels/reset-corrupt-baselines";
import { syncStoreItemSelect, toSyncStoreItem } from "@/lib/channels/store-item";
import {
  fillEmptyTaxonomyAspectsFromTitle,
  remapAspectsToTaxonomy,
  validateListingForEbay,
  validateRemappedAspects,
} from "@/lib/channels/ebay/ebay-compat";
import { parseStoredAspects, aspectsToEbayProductAspects } from "@/lib/listing-limits";
import { getItemAspectsForCategory } from "@/lib/channels/ebay/aspects";
import { getRecentTraces, type SyncTraceSummary } from "@/lib/channels/sync-trace";
import { getErrorCategoryLabel, getSuggestedFixes } from "@/lib/channels/error-classifiers-registry";
import { isImportedEbayLink, extractEbayInventoryAspects } from "@/lib/channels/ebay/listing-origin";
import { ebayGetInventoryItem } from "@/lib/channels/ebay/client";
import {
  getCircuitStatus,
  hydrateCircuitFromConfig,
  resetCircuit,
} from "@/lib/channels/circuit-breaker";

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
  notifications?: {
    enabled: boolean;
    urlSecured: boolean;
    lastEbayWebhookAt: string | null;
    lastEbayWebhookEvent: string | null;
  };
  repairAttempted?: boolean;
  repairResults?: { storeItemId: string; ok: boolean; error?: string }[];
  baselineReset?: { reset: number; linkIds: string[] };
  circuitBreaker?: {
    state: string;
    failures: number;
    lastFailure: string | null;
    openedAt: string | null;
  };
  circuitReset?: boolean;
  refreshedConfig?: boolean;
  syncReadiness?: {
    storeItemId: string;
    ready: boolean;
    blockers: string[];
    remappedAspectPreview: { name: string; value: string }[];
    droppedAspectNames: string[];
  };
  recentTraces?: RecentTrace[];
  passthroughDebug?: {
    linkOrigin: string;
    liveAspects: Record<string, string[]> | null;
    storedAspects: Record<string, string[]>;
    cachedInventoryAspects: Record<string, string[]> | null;
  };
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
 *   - resetCircuit=1 — clear paused sync circuit (after fixing underlying errors)
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
  const resetCircuitParam = searchParams.get("resetCircuit") === "1";
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

  hydrateCircuitFromConfig(ctx.id, ctx.config);

  let circuitReset = false;
  if (resetCircuitParam) {
    await resetCircuit(ctx.id, "ebay", userId);
    circuitReset = true;
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
    await resetCircuit(ctx.id, "ebay", userId);
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

  const circuitStatus = getCircuitStatus(ctx.id);
  const circuitBreaker = {
    state: circuitStatus.state,
    failures: circuitStatus.failures,
    lastFailure: circuitStatus.lastFailure?.toISOString() ?? null,
    openedAt: circuitStatus.openedAt?.toISOString() ?? null,
  };

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
  } else if (circuitStatus.state === "OPEN") {
    verdict = "CIRCUIT_OPEN";
    summary = "Sync is temporarily paused due to repeated failures.";
    nextStep =
      "Use Sync Now in the app, or ?resetCircuit=1 then ?repair=1 on this diagnose URL after deploying the latest fix.";
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

  let syncReadiness: DiagnosisResult["syncReadiness"];
  let passthroughDebug: DiagnosisResult["passthroughDebug"];
  if (storeItemId && tokenValid) {
    const ebayLink = await prisma.channelListingLink.findFirst({
      where: { storeItemId, provider: "ebay", connectionId: ctx.id },
      select: {
        externalListingId: true,
        linkOrigin: true,
        ebayInventoryAspects: true,
      },
    });
    const imported =
      ebayLink &&
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: ebayLink.externalListingId,
        storeItemId,
        linkOrigin: ebayLink.linkOrigin,
      });

    const itemRow = await prisma.storeItem.findFirst({
      where: { id: storeItemId, memberId: userId },
      select: syncStoreItemSelect,
    });
    if (itemRow) {
      const item = toSyncStoreItem(itemRow);
      if (imported && ebayLink) {
        let liveAspects: Record<string, string[]> | null = null;
        try {
          const live = await ebayGetInventoryItem(ctx.accessToken, ebayLink.externalListingId);
          liveAspects = extractEbayInventoryAspects(live as Record<string, unknown>);
        } catch {
          /* optional */
        }
        const stored = aspectsToEbayProductAspects(parseStoredAspects(item.aspects));
        passthroughDebug = {
          linkOrigin: ebayLink.linkOrigin ?? "import",
          liveAspects,
          storedAspects: stored,
          cachedInventoryAspects:
            ebayLink.ebayInventoryAspects &&
            typeof ebayLink.ebayInventoryAspects === "object" &&
            !Array.isArray(ebayLink.ebayInventoryAspects)
              ? (ebayLink.ebayInventoryAspects as Record<string, string[]>)
              : null,
        };
      } else {
      const validation = await validateListingForEbay({ item });
      let remappedAspectPreview: { name: string; value: string }[] = [];
      let droppedAspectNames: string[] = [];
      if (item.ebayCategoryId) {
        try {
          const categoryAspects = await getItemAspectsForCategory(String(item.ebayCategoryId));
          const merged = fillEmptyTaxonomyAspectsFromTitle(
            item.title,
            categoryAspects,
            parseStoredAspects(item.aspects)
          );
          const remapped = remapAspectsToTaxonomy(categoryAspects, merged);
          remappedAspectPreview = remapped.aspects;
          droppedAspectNames = remapped.dropped;
          const aspectValidation = validateRemappedAspects(categoryAspects, remapped.aspects);
          if (aspectValidation.missingRequired.length > 0) {
            validation.errors.push(
              `Missing required specifics after remap: ${aspectValidation.missingRequired.join(", ")}`
            );
          }
        } catch {
          validation.errors.push("Could not load taxonomy for remap preview.");
        }
      }
      syncReadiness = {
        storeItemId,
        ready: validation.valid && config.canPublish,
        blockers: [
          ...(config.publishBlockReason ? [config.publishBlockReason] : []),
          ...validation.errors,
        ],
        remappedAspectPreview,
        droppedAspectNames,
      };
      }
    }
  }

  // Fetch recent sync traces for this connection
  let recentTraces: RecentTrace[] | undefined;
  try {
    const traces = await getRecentTraces(userId, "ebay", {
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
    console.warn("[ebay/diagnose] failed to fetch traces", { error: String(e) });
  }

  return NextResponse.json<DiagnosisResult>({
    ok: verdict === "SYNC_OK",
    verdict,
    summary,
    nextStep,
    connectionId: ctx.id,
    externalShopId: ctx.externalShopId ?? undefined,
    config,
    tokenValid,
    tokenError,
    links,
    revisionStats: revisionStats.length > 0 ? revisionStats : undefined,
    notifications: (() => {
      const receipt = readEbayWebhookReceipt(ctx.config);
      const storedUrl =
        ctx.config && typeof ctx.config === "object" && !Array.isArray(ctx.config)
          ? (ctx.config as { notificationsWebhookUrl?: unknown }).notificationsWebhookUrl
          : null;
      const enabled =
        ctx.config && typeof ctx.config === "object" && !Array.isArray(ctx.config)
          ? (ctx.config as { notificationsEnabled?: unknown }).notificationsEnabled === true
          : false;
      return {
        enabled,
        urlSecured: typeof storedUrl === "string" && ebayWebhookUrlIsSecured(storedUrl),
        lastEbayWebhookAt: receipt.lastEbayWebhookAt,
        lastEbayWebhookEvent: receipt.lastEbayWebhookEvent,
      };
    })(),
    repairAttempted: repair,
    repairResults,
    baselineReset,
    circuitBreaker,
    circuitReset: circuitReset || undefined,
    refreshedConfig,
    syncReadiness,
    passthroughDebug,
    recentTraces,
  });
}
