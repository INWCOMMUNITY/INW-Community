import { prisma } from "database";
import { createHash } from "crypto";
import { getAdapter } from "./registry";
import { getActiveConnectionsForMember, getConnectionContext } from "./connection";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import { syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "./sync-baseline";
import { variantsFingerprint } from "./variant-sync";
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
        cat: item.category,
        sub: item.subcategory,
        sc: item.secondaryCategory,
        ship: item.shippingCostCents,
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

export type PublishToChannelsOptions = {
  /** When set, only these providers are published (must still be active connections). */
  providers?: ChannelProvider[];
};

/**
 * Publish a StoreItem to connected channels that do not yet have a link.
 * Best-effort: failures are returned in the result array and never thrown to the caller.
 */
export async function publishStoreItemToChannels(
  storeItemId: string,
  memberId: string,
  options: PublishToChannelsOptions = {}
): Promise<ChannelSyncResult[]> {
  const results: ChannelSyncResult[] = [];
  let item: SyncStoreItem | null;
  let connections: ChannelConnectionContext[];
  try {
    [item, connections] = await Promise.all([
      loadSyncItem(storeItemId),
      getActiveConnectionsForMember(memberId),
    ]);
  } catch (e) {
    console.error("[channels] publish load failed", { storeItemId, error: String(e) });
    return results;
  }
  if (!item) return results;

  const providerFilter =
    options.providers !== undefined ? new Set(options.providers) : null;
  const targets = providerFilter
    ? connections.filter((c) => providerFilter.has(c.provider))
    : connections;
  if (targets.length === 0) return results;

  for (const conn of targets) {
    const provider = conn.provider;
    const existing = await prisma.channelListingLink.findUnique({
      where: { storeItemId_provider: { storeItemId, provider } },
    });
    if (existing) {
      if (provider === "wix" && item.photos.length > 0) {
        try {
          const { syncWixProductMedia } = await import("./wix/media");
          await syncWixProductMedia(conn, existing.externalListingId, item.photos);
        } catch (e) {
          const msg = String(e).slice(0, 500);
          console.warn("[channels] wix media backfill failed", {
            storeItemId,
            externalListingId: existing.externalListingId,
            error: msg,
          });
          results.push({ provider, ok: false, error: msg });
          continue;
        }
      }
      results.push({ provider, ok: true });
      continue;
    }

    try {
      const adapter = getAdapter(provider);
      const result = await adapter.createListing(conn, item);
      await prisma.channelListingLink.create({
        data: {
          storeItemId,
          connectionId: conn.id,
          provider,
          externalListingId: result.externalListingId,
          externalShopId: result.externalShopId,
          syncEnabled: true,
          syncStatus: "synced",
          syncError: null,
          lastPushedHash: contentHash(item),
          lastPushedAt: new Date(),
          syncBaselineHash: syncContentHash(item),
          syncBaselineMetaHash: syncMetaHash(item),
          syncBaselineVariantsHash: variantsFingerprint(item.variants),
          syncBaselineQty: item.quantity,
          syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
        },
      });
      results.push({ provider, ok: true });
    } catch (e) {
      const msg = String(e).slice(0, 500);
      console.error("[channels] createListing failed", {
        storeItemId,
        provider,
        error: msg,
      });
      results.push({ provider, ok: false, error: msg });
    }
  }
  return results;
}

/** Whether a create/update request should run channel publish. */
export function shouldPublishToChannels(args: {
  syncToChannels?: boolean;
  channelProviders?: ChannelProvider[];
}): boolean {
  if (args.syncToChannels === false) return false;
  if (args.channelProviders !== undefined) return args.channelProviders.length > 0;
  // Legacy: omitted channelProviders + syncToChannels not explicitly false → publish all connections.
  return true;
}

/** Resolve provider list for publish: explicit array, or all active when legacy omit. */
export function resolvePublishProviders(args: {
  syncToChannels?: boolean;
  channelProviders?: ChannelProvider[];
}): ChannelProvider[] | undefined {
  if (!shouldPublishToChannels(args)) return undefined;
  if (args.channelProviders !== undefined) return args.channelProviders;
  return undefined;
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
          syncBaselineHash: syncContentHash(item),
          syncBaselineMetaHash: syncMetaHash(item),
          syncBaselineVariantsHash: variantsFingerprint(item.variants),
          syncBaselineQty: item.quantity,
          syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
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

async function removeStoreItemFromChannelLinks(
  storeItemId: string,
  providers?: ChannelProvider[]
): Promise<ChannelSyncResult[]> {
  const links = await prisma.channelListingLink.findMany({
    where: {
      storeItemId,
      ...(providers?.length ? { provider: { in: providers } } : {}),
    },
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

/** Remove selected external listings and drop links; INW StoreItem is unchanged. */
export async function unpublishStoreItemFromChannels(
  storeItemId: string,
  providers: ChannelProvider[]
): Promise<ChannelSyncResult[]> {
  if (providers.length === 0) return [];
  return removeStoreItemFromChannelLinks(storeItemId, providers);
}

/** Remove the external listing on every channel, then drop the links. Called before deleting a StoreItem. */
export async function deleteStoreItemFromChannels(
  storeItemId: string
): Promise<ChannelSyncResult[]> {
  return removeStoreItemFromChannelLinks(storeItemId);
}
