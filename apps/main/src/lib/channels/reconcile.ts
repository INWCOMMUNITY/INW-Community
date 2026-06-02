import { prisma } from "database";
import { applyStoreItemDecrementAfterSale } from "@/lib/store-item-inventory-sale";
import { shouldMarkStoreItemSoldOut } from "@/lib/store-item-variants";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { getAdapter } from "./registry";
import { getConnectionContext } from "./connection";
import { syncInventoryToChannels } from "./sync-inventory";
import { reconcileConnectionInboundListings } from "./reconcile-inbound";
import { reconcileConnectionInboundCatalog } from "./reconcile-inbound-catalog";
import type { ChannelProvider } from "./types";

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
};

/**
 * Pull recent external sales for one connection and apply any not yet processed:
 * decrement the shared StoreItem.quantity (deduped by event id), mark sold out if needed,
 * and re-push the new absolute quantity to every other linked channel.
 */
export async function reconcileConnectionSales(
  connection: ConnectionRow
): Promise<{ applied: number }> {
  const ctx = await getConnectionContext(connection);
  if (!ctx) return { applied: 0 };
  const provider = connection.provider as ChannelProvider;
  const adapter = getAdapter(provider);

  const since =
    connection.lastReconciledAt &&
    Date.now() - connection.lastReconciledAt.getTime() < DEFAULT_LOOKBACK_MS
      ? new Date(connection.lastReconciledAt.getTime() - 1000 * 60 * 10) // small overlap
      : new Date(Date.now() - DEFAULT_LOOKBACK_MS);

  let sales;
  try {
    sales = await adapter.fetchRecentSales(ctx, since);
  } catch (e) {
    console.error("[channels] fetchRecentSales failed", { provider, error: String(e) });
    await prisma.channelConnection
      .update({ where: { id: connection.id }, data: { status: "error", lastError: String(e).slice(0, 500) } })
      .catch(() => {});
    return { applied: 0 };
  }

  let applied = 0;
  for (const sale of sales) {
    // Dedupe: the unique (provider, externalEventId) row means this sale runs at most once.
    try {
      await prisma.channelSyncEvent.create({
        data: { provider, externalEventId: sale.externalEventId, type: "sale" },
      });
    } catch {
      continue;
    }

    let link = await prisma.channelListingLink.findUnique({
      where: {
        provider_externalListingId: { provider, externalListingId: sale.externalListingId },
      },
    });
    if (!link && sale.sku) {
      link = await prisma.channelListingLink.findFirst({
        where: { storeItemId: sale.sku, provider },
      });
    }
    if (!link) continue;

    const storeItem = await prisma.storeItem.findUnique({ where: { id: link.storeItemId } });
    if (!storeItem) continue;

    await applyStoreItemDecrementAfterSale(prisma, storeItem, {
      quantity: sale.quantitySold,
      variant: null,
    });

    const updated = await prisma.storeItem.findUnique({
      where: { id: link.storeItemId },
      select: { quantity: true, variants: true },
    });
    if (updated && shouldMarkStoreItemSoldOut(updated)) {
      await prisma.storeItem.update({
        where: { id: link.storeItemId },
        data: { status: "sold_out" },
      });
      deleteFeedPostsForSoldItem(link.storeItemId).catch(() => {});
    }

    await prisma.channelSyncEvent
      .update({
        where: { provider_externalEventId: { provider, externalEventId: sale.externalEventId } },
        data: { storeItemId: link.storeItemId },
      })
      .catch(() => {});
    await prisma.channelListingLink
      .update({ where: { id: link.id }, data: { lastInboundAt: new Date() } })
      .catch(() => {});

    // Push the new shared quantity out to the other channels (and back to origin; idempotent).
    await syncInventoryToChannels(link.storeItemId);
    applied += 1;
  }

  await prisma.channelConnection
    .update({ where: { id: connection.id }, data: { lastReconciledAt: new Date(), status: "active", lastError: null } })
    .catch(() => {});
  return { applied };
}

/** Reconcile every active connection (used by the cron and as the webhook fallback). */
export async function reconcileAllConnections(): Promise<{
  connections: number;
  applied: number;
  imported: number;
  catalogUpdated: number;
  catalogRemoved: number;
}> {
  const conns = await prisma.channelConnection.findMany({
    where: { status: { not: "disconnected" } },
  });
  let applied = 0;
  let imported = 0;
  let catalogUpdated = 0;
  let catalogRemoved = 0;
  for (const c of conns) {
    try {
      applied += (await reconcileConnectionSales(c)).applied;
    } catch (e) {
      console.error("[channels] reconcile sales failed", { id: c.id, error: String(e) });
    }
    try {
      const catalog = await reconcileConnectionInboundCatalog(c);
      catalogUpdated += catalog.updated;
      catalogRemoved += catalog.removed;
    } catch (e) {
      console.error("[channels] reconcile catalog failed", { id: c.id, error: String(e) });
    }
    try {
      imported += (await reconcileConnectionInboundListings(c)).imported;
    } catch (e) {
      console.error("[channels] reconcile inbound failed", { id: c.id, error: String(e) });
    }
  }
  return { connections: conns.length, applied, imported, catalogUpdated, catalogRemoved };
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
  const sales = await reconcileConnectionSales(conn);
  await reconcileConnectionInboundCatalog(conn).catch(() => {});
  return sales;
}
