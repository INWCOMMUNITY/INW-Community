import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { reconcileConnectionInboundCatalog } from "@/lib/channels/reconcile-inbound-catalog";
import { reconcileConnectionInboundMeta } from "@/lib/channels/reconcile-inbound-meta";
import { setEtsyConnectionContext } from "@/lib/channels/etsy/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Minimum time between syncs per user (30 seconds)
const SYNC_COOLDOWN_MS = 30_000;

// In-memory cooldown tracker (resets on deploy, which is fine)
const lastSyncByUser = new Map<string, number>();

/**
 * POST /api/channels/sync-on-view
 * 
 * Lightweight sync trigger for when user opens store/inventory page.
 * Has a 30-second cooldown to prevent excessive API calls.
 * 
 * Call this from the mobile app when:
 * - User opens the Store tab
 * - User pulls to refresh on inventory
 * - User navigates to a linked listing
 * 
 * This ensures the user always sees the latest data from Etsy.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check cooldown
  const lastSync = lastSyncByUser.get(userId) ?? 0;
  const now = Date.now();
  if (now - lastSync < SYNC_COOLDOWN_MS) {
    const waitSec = Math.ceil((SYNC_COOLDOWN_MS - (now - lastSync)) / 1000);
    return NextResponse.json({
      ok: true,
      synced: false,
      reason: "cooldown",
      retryInSeconds: waitSec,
    });
  }

  // Update cooldown immediately to prevent concurrent requests
  lastSyncByUser.set(userId, now);

  // Get user's active Etsy connection (most common case)
  const connections = await prisma.channelConnection.findMany({
    where: {
      memberId: userId,
      status: "active",
      provider: { in: ["etsy", "ebay"] }, // Only platforms without real-time webhooks
    },
  });

  if (connections.length === 0) {
    return NextResponse.json({
      ok: true,
      synced: false,
      reason: "no_connections",
    });
  }

  const results: {
    provider: string;
    catalogUpdated: number;
    metaUpdated: number;
    removed: number;
  }[] = [];

  for (const conn of connections) {
    if (conn.provider === "etsy") {
      setEtsyConnectionContext(conn.id);
    }

    try {
      if (conn.provider === "ebay") {
        const { pullEbayUpdatesForConnection } = await import(
          "@/lib/channels/ebay/pull-ebay-updates"
        );
        const pull = await pullEbayUpdatesForConnection(conn);
        results.push({
          provider: conn.provider,
          catalogUpdated: pull.updated.length,
          metaUpdated: 0,
          removed: 0,
        });
        continue;
      }
      const catalog = await reconcileConnectionInboundCatalog(conn);
      const meta = await reconcileConnectionInboundMeta(conn);
      results.push({
        provider: conn.provider,
        catalogUpdated: catalog.updated,
        metaUpdated: meta.updated,
        removed: catalog.removed + meta.removed,
      });
    } catch (e) {
      console.error("[sync-on-view] sync failed", {
        provider: conn.provider,
        error: String(e),
      });
    }
  }

  const totalCatalogUpdated = results.reduce((sum, r) => sum + r.catalogUpdated, 0);
  const totalMetaUpdated = results.reduce((sum, r) => sum + r.metaUpdated, 0);
  const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);

  return NextResponse.json({
    ok: true,
    synced: true,
    results,
    summary: {
      updated: totalCatalogUpdated + totalMetaUpdated,
      catalogUpdated: totalCatalogUpdated,
      metaUpdated: totalMetaUpdated,
      removed: totalRemoved,
    },
  });
}
