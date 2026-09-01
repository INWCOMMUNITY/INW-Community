import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { reconcileConnectionInboundCatalog } from "@/lib/channels/reconcile-inbound-catalog";
import { reconcileConnectionInboundMeta } from "@/lib/channels/reconcile-inbound-meta";
import { setEtsyConnectionContext } from "@/lib/channels/etsy/client";
import { flagGoneWixListingsForConnection } from "@/lib/channels/wix/flag-remote-deleted";
import { maybeImportShippingOptionsOnSync } from "@/lib/shipping-options";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYNC_COOLDOWN_MS = 30_000;
const lastSyncByUser = new Map<string, number>();

/**
 * POST /api/channels/sync-on-view
 *
 * Lightweight sync when the seller opens My Items.
 * Wix deletes are always re-checked (no cooldown) so listing tags drop immediately.
 * Etsy catalog pulls stay on a 30-second cooldown.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lastSync = lastSyncByUser.get(userId) ?? 0;
  const now = Date.now();
  const onCooldown = now - lastSync < SYNC_COOLDOWN_MS;

  const connections = await prisma.channelConnection.findMany({
    where: {
      memberId: userId,
      status: { not: "disconnected" },
      provider: { in: ["etsy", "wix"] },
    },
  });

  const wixConnections = connections.filter((c) => c.provider === "wix");
  const etsyConnections = onCooldown
    ? []
    : connections.filter((c) => c.provider === "etsy" && c.status === "active");

  if (wixConnections.length === 0 && etsyConnections.length === 0) {
    return NextResponse.json({
      ok: true,
      synced: false,
      reason: connections.length === 0 ? "no_connections" : "cooldown",
    });
  }

  if (!onCooldown) lastSyncByUser.set(userId, now);

  const results: {
    provider: string;
    catalogUpdated: number;
    metaUpdated: number;
    removed: number;
  }[] = [];

  for (const conn of wixConnections) {
    try {
      const flagged = await flagGoneWixListingsForConnection(conn);
      results.push({
        provider: conn.provider,
        catalogUpdated: 0,
        metaUpdated: 0,
        removed: flagged.removed,
      });
    } catch (e) {
      console.error("[sync-on-view] Wix delete check failed", { error: String(e) });
    }
  }

  for (const conn of etsyConnections) {
    setEtsyConnectionContext(conn.id);
    await maybeImportShippingOptionsOnSync(userId, "etsy").catch(() => {});
    try {
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
