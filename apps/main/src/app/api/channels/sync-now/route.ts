import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getConnectionContext } from "@/lib/channels/connection";
import { reconcileConnectionInboundCatalog } from "@/lib/channels/reconcile-inbound-catalog";
import { updateStoreItemOnChannels } from "@/lib/channels/outbound";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { setEtsyConnectionContext } from "@/lib/channels/etsy/client";
import type { ChannelProvider } from "@/lib/channels/types";
import {
  hydrateCircuitFromConfig,
  resetCircuit,
} from "@/lib/channels/circuit-breaker";
import { maybeImportShippingOptionsOnSync } from "@/lib/shipping-options";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SyncResult = {
  ok: boolean;
  direction: "inbound" | "outbound" | "both";
  provider: string;
  inbound?: {
    updated: number;
    removed: number;
  };
  outbound?: {
    pushed: number;
    errors: string[];
  };
  error?: string;
  durationMs: number;
};

/**
 * POST /api/channels/sync-now
 * 
 * Triggers immediate two-way sync for the current user's channel connections.
 * 
 * Query params:
 *   - provider: Filter to specific provider (etsy, ebay, wix, shopify)
 *   - direction: "inbound" (channel→INW), "outbound" (INW→channel), or "both" (default)
 *   - storeItemId: Only sync a specific item (outbound only)
 * 
 * This endpoint is designed for users to manually trigger sync when they
 * make changes on Etsy and want immediate reflection in INW, or vice versa.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const providerFilter = searchParams.get("provider") as ChannelProvider | null;
  const direction = (searchParams.get("direction") || "both") as "inbound" | "outbound" | "both";
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;

  const startTime = Date.now();
  const results: SyncResult[] = [];

  // Get user's active connections
  const connections = await prisma.channelConnection.findMany({
    where: {
      memberId: userId,
      status: { not: "disconnected" },
      ...(providerFilter ? { provider: providerFilter } : {}),
    },
  });

  if (connections.length === 0) {
    return NextResponse.json({
      ok: false,
      error: providerFilter
        ? `No active ${providerFilter} connection found`
        : "No active channel connections found",
      results: [],
    });
  }

  for (const conn of connections) {
    const provider = conn.provider as ChannelProvider;
    const result: SyncResult = {
      ok: true,
      direction,
      provider,
      durationMs: 0,
    };
    const connStart = Date.now();

    // Set connection context for rate limiting
    if (provider === "etsy") {
      setEtsyConnectionContext(conn.id);
    }

    try {
      const ctx = await getConnectionContext(conn);
      if (!ctx) {
        const latest = await prisma.channelConnection.findUnique({
          where: { id: conn.id },
          select: { lastError: true },
        });
        result.ok = false;
        result.error =
          latest?.lastError ??
          `${provider.charAt(0).toUpperCase() + provider.slice(1)} connection needs reconnecting. Open Sync Stores.`;
        result.durationMs = Date.now() - connStart;
        results.push(result);
        continue;
      }

      // User explicitly requested sync — clear any paused circuit so we can retry.
      hydrateCircuitFromConfig(conn.id, conn.config);
      await resetCircuit(conn.id, provider, userId);

      // INBOUND: Pull changes from channel to INW
      if (direction === "inbound" || direction === "both") {
        console.log("[sync-now] starting inbound sync", { provider, connectionId: conn.id });
        if (provider === "ebay" || provider === "etsy") {
          await maybeImportShippingOptionsOnSync(userId, provider).catch(() => {});
        }
        const inboundResult = await reconcileConnectionInboundCatalog(conn);
        result.inbound = {
          updated: inboundResult.updated,
          removed: inboundResult.removed,
        };
        console.log("[sync-now] inbound sync complete", { provider, ...inboundResult });
      }

      // OUTBOUND: Push changes from INW to channel
      if (direction === "outbound" || direction === "both") {
        console.log("[sync-now] starting outbound sync", { provider, connectionId: conn.id, storeItemId });
        
        // Get linked items to push
        const links = await prisma.channelListingLink.findMany({
          where: {
            connectionId: conn.id,
            syncEnabled: true,
            ...(storeItemId ? { storeItemId } : {}),
          },
          select: { storeItemId: true },
          distinct: ["storeItemId"],
        });

        const errors: string[] = [];
        let pushed = 0;

        if (storeItemId && links.length === 0) {
          const { publishStoreItemToChannels } = await import("@/lib/channels/outbound");
          const publishResults = await publishStoreItemToChannels(storeItemId, conn.memberId, {
            providers: [provider],
          });
          const pr = publishResults.find((r) => r.provider === provider);
          if (pr?.ok) {
            pushed = 1;
          } else if (pr?.error) {
            errors.push(pr.error);
          } else {
            errors.push(
              "No listing was published — check eBay category, photos, and business policies in Sync Stores."
            );
          }
        } else {
          for (const link of links) {
            try {
              const contentResults = await updateStoreItemOnChannels(link.storeItemId);
              const inventoryResults = await syncInventoryToChannels(link.storeItemId);

              const providerResult = [...contentResults, ...inventoryResults].find(
                (r) => r.provider === provider
              );

              if (providerResult?.ok) {
                pushed++;
              } else if (providerResult?.error) {
                errors.push(`${link.storeItemId}: ${providerResult.error}`);
              }
            } catch (e) {
              errors.push(`${link.storeItemId}: ${String(e)}`);
            }
          }
        }

        if (storeItemId && pushed === 0 && errors.length > 0) {
          result.ok = false;
          result.error = errors[0];
        }

        result.outbound = { pushed, errors: errors.slice(0, 5) }; // Limit error count
        console.log("[sync-now] outbound sync complete", { provider, pushed, errorCount: errors.length });
      }
    } catch (e) {
      result.ok = false;
      result.error = e instanceof Error ? e.message : String(e);
      console.error("[sync-now] sync failed", { provider, error: result.error });
    }

    result.durationMs = Date.now() - connStart;
    results.push(result);
  }

  const totalDuration = Date.now() - startTime;
  const allOk = results.every((r) => r.ok);

  return NextResponse.json({
    ok: allOk,
    results,
    totalDurationMs: totalDuration,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/channels/sync-now
 * 
 * Returns sync status and last sync times for each connection.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.channelConnection.findMany({
    where: { memberId: userId },
    select: {
      id: true,
      provider: true,
      externalShopName: true,
      status: true,
      lastReconciledAt: true,
      lastError: true,
      _count: {
        select: {
          listingLinks: true,
        },
      },
    },
  });

  // Get recent sync logs
  const recentLogs = await prisma.channelSyncLog.findMany({
    where: { memberId: userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      provider: true,
      action: true,
      detail: true,
      storeItemId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    connections: connections.map((c) => ({
      provider: c.provider,
      shopName: c.externalShopName,
      status: c.status,
      lastSyncAt: c.lastReconciledAt?.toISOString() ?? null,
      lastError: c.lastError,
      linkedItems: c._count.listingLinks,
    })),
    recentActivity: recentLogs.map((l) => ({
      provider: l.provider,
      action: l.action,
      detail: l.detail,
      storeItemId: l.storeItemId,
      at: l.createdAt.toISOString(),
    })),
    cronEnabled: process.env.CHANNEL_CRON_SYNC_ENABLED === "true",
  });
}
