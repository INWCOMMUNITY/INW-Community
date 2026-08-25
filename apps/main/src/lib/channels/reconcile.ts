import { prisma } from "database";
import { getAdapter } from "./registry";
import { getConnectionContext, withConnectionAuthRetry, markChannelConnectionFailure } from "./connection";
import { reconcileConnectionInboundListings } from "./reconcile-inbound";
import { reconcileConnectionInboundCatalog } from "./reconcile-inbound-catalog";
import { reconcileConnectionInboundMeta } from "./reconcile-inbound-meta";
import type { ChannelProvider } from "./types";
import { describeChannelSyncError } from "./ebay/errors";
import { ensureEbayPlatformNotifications } from "./ebay/notifications-setup";
import { pullEbayUpdatesForConnection } from "./ebay/pull-ebay-updates";
import { logSyncEvent } from "./sync-log";
import { findChannelLinkForSale } from "./sale-link";
import { maybeImportShippingOptionsOnSync } from "@/lib/shipping-options";
import { applyInboundChannelSale } from "./apply-channel-sale";

const DEFAULT_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 2; // 2 days

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: string;
  etsyShippingProfileId: string | null;
  lastReconciledAt: Date | null;
  config?: unknown;
};

/**
 * Pull recent external sales for one connection and apply any not yet processed:
 * decrement the shared StoreItem.quantity (deduped by event id), mark sold out if needed,
 * and re-push the new absolute quantity to every other linked channel.
 */
export async function reconcileConnectionSales(
  connection: ConnectionRow
): Promise<{ applied: number; paused: boolean; salesFetched: boolean }> {
  const provider = connection.provider as ChannelProvider;
  const adapter = getAdapter(provider);

  const since =
    connection.lastReconciledAt &&
    Date.now() - connection.lastReconciledAt.getTime() < DEFAULT_LOOKBACK_MS
      ? new Date(connection.lastReconciledAt.getTime() - 1000 * 60 * 10) // small overlap
      : new Date(Date.now() - DEFAULT_LOOKBACK_MS);

  let sales;
  try {
    sales = await withConnectionAuthRetry(connection, (ctx) =>
      adapter.fetchRecentSales(ctx, since)
    );
  } catch (e) {
    const msg = describeChannelSyncError(provider, e);
    console.error("[channels] fetchRecentSales failed", { provider, error: msg });
    const { paused } = await markChannelConnectionFailure({
      connection,
      error: e,
      lastError: msg,
    });
    if (paused) return { applied: 0, paused: true, salesFetched: false };
    const latest = await prisma.channelConnection
      .findUnique({ where: { id: connection.id }, select: { status: true } })
      .catch(() => null);
    return { applied: 0, paused: latest?.status === "error", salesFetched: false };
  }

  let applied = 0;
  for (const sale of sales) {
    const link = await findChannelLinkForSale(provider, sale);
    if (!link) {
      console.warn("[channels] sale unmatched; will retry next cron", {
        provider,
        externalEventId: sale.externalEventId,
        externalListingId: sale.externalListingId,
        sku: sale.sku ?? null,
        legacyItemId: sale.legacyItemId ?? null,
      });
      logSyncEvent(
        connection.memberId,
        provider,
        "sale_unmatched",
        `Sale ${sale.externalEventId} listing=${sale.externalListingId} sku=${sale.sku ?? ""} legacy=${sale.legacyItemId ?? ""}`
      );
      continue;
    }

    const storeItem = await prisma.storeItem.findUnique({ where: { id: link.storeItemId } });
    if (!storeItem) {
      // Burn the event: the listing link is orphaned and retrying will not help.
      await prisma.channelSyncEvent
        .create({
          data: {
            provider,
            externalEventId: sale.externalEventId,
            type: "sale",
            storeItemId: link.storeItemId,
            payload: { quantitySold: sale.quantitySold, skipped: "missing_store_item" },
            appliedAt: new Date(),
          },
        })
        .catch(() => {});
      continue;
    }

    const result = await applyInboundChannelSale({
      provider,
      memberId: connection.memberId,
      sale,
      storeItem,
      linkId: link.id,
    });
    if (result === "applied") applied += 1;
  }

  await prisma.channelConnection
    .update({ where: { id: connection.id }, data: { lastReconciledAt: new Date(), status: "active", lastError: null } })
    .catch(() => {});
  return { applied, paused: false, salesFetched: true };
}

/** Sales cursor only moves after a successful fetch so a failed pull cannot drop later sales. */
export function shouldAdvanceLastReconciledAt(result: {
  salesFetched: boolean;
  paused: boolean;
}): boolean {
  return result.salesFetched && !result.paused;
}

/**
 * Mark recent remote sales as already processed (ChannelSyncEvent) without decrementing INW.
 * Used when quantity was set absolutely from the channel (e.g. eBay GetItem after a sale
 * webhook) so a later sales poll cannot double-apply the same orders.
 */
export async function acknowledgeRecentSalesWithoutDecrement(
  connection: ConnectionRow
): Promise<{ acknowledged: number }> {
  const ctx = await getConnectionContext(connection);
  if (!ctx) return { acknowledged: 0 };
  const provider = connection.provider as ChannelProvider;
  const adapter = getAdapter(provider);

  const since =
    connection.lastReconciledAt &&
    Date.now() - connection.lastReconciledAt.getTime() < DEFAULT_LOOKBACK_MS
      ? new Date(connection.lastReconciledAt.getTime() - 1000 * 60 * 10)
      : new Date(Date.now() - DEFAULT_LOOKBACK_MS);

  let sales;
  try {
    sales = await adapter.fetchRecentSales(ctx, since);
  } catch {
    return { acknowledged: 0 };
  }

  let acknowledged = 0;
  for (const sale of sales) {
    try {
      await prisma.channelSyncEvent.create({
        data: {
          provider,
          externalEventId: sale.externalEventId,
          type: "sale_ack_absolute",
          appliedAt: new Date(),
          payload: { applied: true, ack: "absolute" },
        },
      });
      acknowledged += 1;
    } catch {
      /* already recorded */
    }
  }
  return { acknowledged };
}

const RECONCILE_BATCH_SIZE = 5;

/**
 * Reconcile a single connection (all operations).
 */
async function reconcileSingleConnection(c: ConnectionRow): Promise<{
  applied: number;
  imported: number;
  catalogUpdated: number;
  catalogRemoved: number;
  metaUpdated: number;
}> {
  let applied = 0;
  let imported = 0;
  let catalogUpdated = 0;
  let catalogRemoved = 0;
  let metaUpdated = 0;
  let keepPaused = false;

  if (c.provider === "ebay" || c.provider === "etsy") {
    await maybeImportShippingOptionsOnSync(c.memberId, c.provider).catch(() => {});
  }

  if (c.provider === "ebay") {
    try {
      const ctx = await getConnectionContext(c);
      if (ctx) {
        await ensureEbayPlatformNotifications({
          connectionId: c.id,
          accessToken: ctx.accessToken,
          config: c.config,
        });
      }
    } catch (e) {
      console.warn("[channels] eBay notification repair failed", {
        id: c.id,
        error: String(e),
      });
    }
  }

  try {
    const sales = await reconcileConnectionSales(c);
    applied += sales.applied;
    keepPaused = sales.paused;
  } catch (e) {
    console.error("[channels] reconcile sales failed", { id: c.id, error: String(e) });
  }
  if (c.provider === "ebay") {
    try {
      const ebayPull = await pullEbayUpdatesForConnection(c);
      catalogUpdated += ebayPull.updated.length;
      console.log("[channels] eBay GetItem pull", {
        id: c.id,
        checked: ebayPull.checked,
        updated: ebayPull.updated.map((u) => ({ storeItemId: u.storeItemId, changes: u.changes })),
      });
    } catch (e) {
      console.error("[channels] eBay GetItem pull failed", { id: c.id, error: String(e) });
    }
    // Do not run GetMyeBaySelling catalog/meta after a live GetItem pull.
    // That seller-list + Inventory overlay can rewrite the listing back to a lagged title/price.
  } else {
    try {
      const catalog = await reconcileConnectionInboundCatalog(c);
      catalogUpdated += catalog.updated;
      catalogRemoved += catalog.removed;
    } catch (e) {
      console.error("[channels] reconcile catalog failed", { id: c.id, error: String(e) });
    }
    try {
      const meta = await reconcileConnectionInboundMeta(c);
      metaUpdated += meta.updated;
    } catch (e) {
      console.error("[channels] reconcile meta failed", { id: c.id, error: String(e) });
    }
  }
  try {
    imported += (await reconcileConnectionInboundListings(c)).imported;
  } catch (e) {
    console.error("[channels] reconcile inbound failed", { id: c.id, error: String(e) });
  }

  // lastReconciledAt is the sales cursor — only reconcileConnectionSales advances it
  // after a successful fetch. Do not bump here on pause/failure or later ticks drop sales.
  if (keepPaused) {
    console.warn("[channels] connection left paused; sales cursor not advanced", { id: c.id });
  }

  return { applied, imported, catalogUpdated, catalogRemoved, metaUpdated };
}

/** Reconcile every active connection (used by the cron and as the webhook fallback).
 * Uses parallel batch processing for better performance.
 * Prioritizes connections with recent errors or recent sales.
 */
export async function reconcileAllConnections(opts?: {
  skipProviders?: ChannelProvider[];
  passStartedAt?: Date;
}): Promise<{
  connections: number;
  applied: number;
  imported: number;
  catalogUpdated: number;
  catalogRemoved: number;
  metaUpdated: number;
}> {
  const skip = new Set(opts?.skipProviders ?? []);
  const passStartedAt = opts?.passStartedAt;
  const conns = await prisma.channelConnection.findMany({
    where: {
      status: { not: "disconnected" },
      ...(passStartedAt
        ? {
            OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: passStartedAt } }],
          }
        : {}),
    },
    include: {
      _count: {
        select: {
          listingLinks: {
            where: { syncStatus: "error" },
          },
        },
      },
    },
    orderBy: [
      { lastReconciledAt: { sort: "asc", nulls: "first" } },
    ],
  });

  const prioritized = conns.sort((a, b) => {
    const aErrors = a._count.listingLinks;
    const bErrors = b._count.listingLinks;
    if (aErrors !== bErrors) return bErrors - aErrors;
    return 0;
  });

  let applied = 0;
  let imported = 0;
  let catalogUpdated = 0;
  let catalogRemoved = 0;
  let metaUpdated = 0;

  for (let i = 0; i < prioritized.length; i += RECONCILE_BATCH_SIZE) {
    const batch = prioritized
      .slice(i, i + RECONCILE_BATCH_SIZE)
      .filter((c) => !skip.has(c.provider as ChannelProvider));
    if (batch.length === 0) continue;
    const results = await Promise.allSettled(
      batch.map((c) => reconcileSingleConnection(c))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        applied += result.value.applied;
        imported += result.value.imported;
        catalogUpdated += result.value.catalogUpdated;
        catalogRemoved += result.value.catalogRemoved;
        metaUpdated += result.value.metaUpdated;
      }
    }
  }

  return { connections: conns.length, applied, imported, catalogUpdated, catalogRemoved, metaUpdated };
}

/** Reconcile a single member+provider connection (webhook low-latency trigger). */
export async function reconcileMemberProvider(
  memberId: string,
  provider: ChannelProvider
): Promise<{ applied: number }> {
  const conn = await prisma.channelConnection.findUnique({
    where: { memberId_provider: { memberId, provider } },
  });
  if (!conn || conn.status === "disconnected") return { applied: 0 };
  if (provider === "ebay" || provider === "etsy") {
    await maybeImportShippingOptionsOnSync(memberId, provider).catch(() => {});
  }
  const sales = await reconcileConnectionSales(conn);
  if (provider === "ebay") {
    await pullEbayUpdatesForConnection(conn).catch(() => {});
  } else {
    await reconcileConnectionInboundCatalog(conn).catch(() => {});
    await reconcileConnectionInboundMeta(conn).catch(() => {});
  }
  return sales;
}
