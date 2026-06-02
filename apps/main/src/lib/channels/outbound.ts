import { prisma } from "database";
import { createHash } from "crypto";
import { getAdapter } from "./registry";
import { getActiveConnectionsForMember, getConnectionContext } from "./connection";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import type {
  ChannelConnectionContext,
  ChannelProvider,
  ChannelSyncResult,
  SyncStoreItem,
} from "./types";

/** Content fingerprint so we can skip no-op pushes on update. */
function contentHash(item: SyncStoreItem): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        t: item.title,
        d: item.description,
        p: item.priceCents,
        q: item.quantity,
        s: item.status,
        ph: item.photos,
        v: item.variants,
        c: item.condition,
        // Channel-specific attributes so edits to just these still push to the channel.
        ewm: item.etsyWhoMade,
        eww: item.etsyWhenMade,
        eis: item.etsyIsSupply,
        etx: item.etsyTaxonomyId,
        ebc: item.ebayCategoryId,
      })
    )
    .digest("hex");
}

async function loadSyncItem(storeItemId: string): Promise<SyncStoreItem | null> {
  const row = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: syncStoreItemSelect,
  });
  return row ? toSyncStoreItem(row) : null;
}

/**
 * Publish a StoreItem to all of the seller's connected channels that do not yet have a link.
 * Best-effort: failures are recorded on the link/connection and never thrown to the caller.
 */
export async function publishStoreItemToChannels(
  storeItemId: string,
  memberId: string
): Promise<void> {
  let item: SyncStoreItem | null;
  let connections: ChannelConnectionContext[];
  try {
    [item, connections] = await Promise.all([
      loadSyncItem(storeItemId),
      getActiveConnectionsForMember(memberId),
    ]);
  } catch (e) {
    console.error("[channels] publish load failed", { storeItemId, error: String(e) });
    return;
  }
  if (!item || connections.length === 0) return;

  for (const conn of connections) {
    const existing = await prisma.channelListingLink.findUnique({
      where: { storeItemId_provider: { storeItemId, provider: conn.provider } },
    });
    if (existing) continue; // already linked (e.g. imported) -> handled by update path

    try {
      const adapter = getAdapter(conn.provider);
      const result = await adapter.createListing(conn, item);
      await prisma.channelListingLink.create({
        data: {
          storeItemId,
          connectionId: conn.id,
          provider: conn.provider,
          externalListingId: result.externalListingId,
          externalShopId: result.externalShopId,
          syncEnabled: true,
          syncStatus: "synced",
          lastPushedHash: contentHash(item),
          lastPushedAt: new Date(),
        },
      });
    } catch (e) {
      console.error("[channels] createListing failed", {
        storeItemId,
        provider: conn.provider,
        error: String(e),
      });
      await prisma.channelConnection
        .update({
          where: { id: conn.id },
          data: { status: "error", lastError: String(e).slice(0, 500) },
        })
        .catch(() => {});
    }
  }
}

export type ChannelPushOptions = {
  skipProviders?: ChannelProvider[];
};

/** Push content + inventory updates for an edited StoreItem to every linked channel. */
export async function updateStoreItemOnChannels(
  storeItemId: string,
  options: ChannelPushOptions = {}
): Promise<ChannelSyncResult[]> {
  const skip = new Set(options.skipProviders ?? []);
  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId, syncEnabled: true },
    include: { connection: true },
  });
  const results: ChannelSyncResult[] = [];
  if (links.length === 0) return results;
  const item = await loadSyncItem(storeItemId);
  if (!item) return results;
  const hash = contentHash(item);

  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    if (skip.has(provider)) continue;
    if (link.lastPushedHash === hash) continue; // no content change
    try {
      const ctx = await getConnectionContext(link.connection);
      if (!ctx) throw new Error("Channel connection unavailable or needs reconnecting.");
      const adapter = getAdapter(provider);
      await adapter.updateListing(ctx, link.externalListingId, item);
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          syncStatus: "synced",
          syncError: null,
          lastPushedHash: hash,
          lastPushedAt: new Date(),
        },
      });
      results.push({ provider, ok: true });
    } catch (e) {
      const msg = String(e).slice(0, 500);
      console.error("[channels] updateListing failed", {
        storeItemId,
        provider: link.provider,
        error: msg,
      });
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { syncStatus: "error", syncError: msg },
        })
        .catch(() => {});
      results.push({ provider, ok: false, error: msg });
    }
  }
  return results;
}

/** Remove the external listing on every channel, then drop the links. Called before deleting a StoreItem. */
export async function deleteStoreItemFromChannels(
  storeItemId: string
): Promise<ChannelSyncResult[]> {
  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId },
    include: { connection: true },
  });
  const results: ChannelSyncResult[] = [];
  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    try {
      const ctx = await getConnectionContext(link.connection);
      if (!ctx) throw new Error("Channel connection unavailable or needs reconnecting.");
      const adapter = getAdapter(provider);
      await adapter.deleteListing(ctx, link.externalListingId);
      results.push({ provider, ok: true });
    } catch (e) {
      const msg = String(e).slice(0, 500);
      console.error("[channels] deleteListing failed", {
        storeItemId,
        provider: link.provider,
        error: msg,
      });
      results.push({ provider, ok: false, error: msg });
    }
    await prisma.channelListingLink.delete({ where: { id: link.id } }).catch(() => {});
  }
  return results;
}
