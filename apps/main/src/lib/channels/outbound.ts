import { prisma } from "database";
import { getAdapter } from "./registry";
import { getActiveConnectionsForMember, withConnectionAuthRetry } from "./connection";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import {
  storeItemContentHash,
  syncContentHash,
  syncMetaHash,
  SYNC_ECHO_SKEW_MS,
} from "./sync-baseline";
import { variantsFingerprint } from "./variant-sync";
import type {
  ChannelConnectionContext,
  ChannelProvider,
  ChannelSyncResult,
  SyncStoreItem,
} from "./types";
import { describeChannelSyncError } from "./ebay/errors";
import { enqueueRetry } from "./retry-queue";
import { captureChannelSyncError } from "./sentry";
import { syncInventoryToChannels } from "./sync-inventory";
import {
  isCircuitOpen,
  recordCircuitSuccess,
  recordCircuitFailure,
  hydrateCircuitFromConfig,
} from "./circuit-breaker";
import { logSyncEvent } from "./sync-log";
import { formatProviderPublishError, validateForProvider } from "./validate-publish";
/** Content fingerprint so we can skip no-op pushes on update. */
function contentHash(item: SyncStoreItem): string {
  return storeItemContentHash(item);
}

async function loadSyncItem(storeItemId: string): Promise<SyncStoreItem | null> {
  const row = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: syncStoreItemSelect,
  });
  return row ? toSyncStoreItem(row) : null;
}

/**
 * Apply per-channel price adjustment to an item for outbound push.
 * Returns a new item object with adjusted price.
 */
function applyPriceAdjustment(item: SyncStoreItem, adjustmentPercent: number): SyncStoreItem {
  if (adjustmentPercent === 0) return item;
  
  const multiplier = 1 + (adjustmentPercent / 100);
  const adjustedPrice = Math.round(item.priceCents * multiplier);
  
  return {
    ...item,
    priceCents: Math.max(0, adjustedPrice), // Never go negative
  };
}

type SyncPrefs = {
  syncEnabled: boolean;
  syncTitles: boolean;
  syncDescriptions: boolean;
  syncPhotos: boolean;
  syncPrices: boolean;
  safetyBuffer: number;
};

/**
 * Load member sync preferences for content sync toggles.
 */
async function loadSyncPreferences(memberId: string): Promise<SyncPrefs> {
  const prefs = await prisma.memberSyncPreferences.findUnique({
    where: { memberId },
    select: {
      syncEnabled: true,
      syncTitles: true,
      syncDescriptions: true,
      syncPhotos: true,
      syncPrices: true,
      safetyBuffer: true,
    },
  });
  return {
    syncEnabled: prefs?.syncEnabled ?? true,
    syncTitles: prefs?.syncTitles ?? true,
    syncDescriptions: prefs?.syncDescriptions ?? true,
    syncPhotos: prefs?.syncPhotos ?? true,
    syncPrices: prefs?.syncPrices ?? true,
    safetyBuffer: prefs?.safetyBuffer ?? 0,
  };
}

/**
 * Check if any content fields have changed based on sync preferences.
 * Returns true if the item should be pushed (has changes in enabled fields).
 */
function hasEnabledContentChanges(
  currentItem: SyncStoreItem,
  previousHash: string | null,
  syncPrefs: SyncPrefs
): boolean {
  // If no previous hash, always push (new or never synced)
  if (!previousHash) return true;
  
  // If all content sync is disabled, no content changes should trigger a push
  if (!syncPrefs.syncTitles && !syncPrefs.syncDescriptions && !syncPrefs.syncPhotos && !syncPrefs.syncPrices) {
    return false;
  }
  
  // Otherwise, we rely on the hash comparison which happens later
  return true;
}

const SYNC_DISABLED_ERROR =
  "Sync is turned off in your store settings. Turn sync on in Sync Stores to list on connected stores.";

function providerDisplayName(provider: ChannelProvider): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function syncDirectionBlockReason(direction: string): string {
  if (direction === "paused") {
    return "Sync with this store is paused. Resume sync in Sync Stores to list from INW.";
  }
  return "This store is set to pull-only. Turn on two-way or push sync in Sync Stores to list from INW.";
}

function failedRowsForProviders(
  providers: ChannelProvider[],
  error: string
): ChannelSyncResult[] {
  return providers.map((provider) => ({ provider, ok: false, error }));
}

export type PublishToChannelsOptions = {
  /** When set, only these providers are published (must still be active connections). */
  providers?: ChannelProvider[];
};

/**
 * Publish a StoreItem to connected channels that do not yet have a link.
 * Best-effort: failures are returned in the result array and never thrown to the caller.
 * When `providers` is set, every requested provider gets a result row (never a silent empty array).
 */
export async function publishStoreItemToChannels(
  storeItemId: string,
  memberId: string,
  options: PublishToChannelsOptions = {}
): Promise<ChannelSyncResult[]> {
  const results: ChannelSyncResult[] = [];
  const requested = options.providers;

  const syncPrefs = await loadSyncPreferences(memberId);

  let item: SyncStoreItem | null;
  let connections: ChannelConnectionContext[];
  try {
    [item, connections] = await Promise.all([
      loadSyncItem(storeItemId),
      getActiveConnectionsForMember(memberId),
    ]);
  } catch (e) {
    console.error("[channels] publish load failed", { storeItemId, error: String(e) });
    if (requested?.length) {
      return failedRowsForProviders(requested, "Could not load this listing or your store connections.");
    }
    return results;
  }
  if (!item) {
    if (requested?.length) {
      return failedRowsForProviders(requested, "Item not found.");
    }
    return results;
  }

  const targets = requested ?? connections.map((c) => c.provider);
  if (targets.length === 0) return results;

  if (!syncPrefs.syncEnabled) {
    return failedRowsForProviders(targets, SYNC_DISABLED_ERROR);
  }

  const connByProvider = new Map(connections.map((c) => [c.provider, c]));

  for (const provider of targets) {
    const conn = connByProvider.get(provider);
    if (!conn) {
      results.push({
        provider,
        ok: false,
        error: `${providerDisplayName(provider)} is not connected. Connect it in Sync Stores first.`,
      });
      continue;
    }

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

    const connConfig = (conn.config ?? {}) as Record<string, unknown>;
    const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
    if (syncDirection === "pull_only" || syncDirection === "paused") {
      results.push({
        provider,
        ok: false,
        error: syncDirectionBlockReason(syncDirection),
      });
      continue;
    }

    try {
      const validation = await validateForProvider(item, provider, {
        provider,
        status: "active",
        etsyShippingProfileId: conn.etsyShippingProfileId,
        config: conn.config,
      });
      if (!validation.valid) {
        results.push({
          provider,
          ok: false,
          error: formatProviderPublishError(validation),
        });
        continue;
      }

      const adapter = getAdapter(provider);
      const priceAdjustmentPercent = (connConfig.priceAdjustmentPercent as number) ?? 0;
      const adjustedItem = applyPriceAdjustment(item, priceAdjustmentPercent);

      const result = await adapter.createListing(conn, adjustedItem);
      const live = result.live !== false;
      await prisma.channelListingLink.create({
        data: {
          storeItemId,
          connectionId: conn.id,
          provider,
          externalListingId: result.externalListingId,
          externalShopId: result.externalShopId,
          ...(provider === "ebay" ? { linkOrigin: "inw_create" as const } : {}),
          syncEnabled: true,
          syncStatus: live ? "synced" : "error",
          syncError: live ? null : (result.warning ?? "Created as a draft — it is not live yet."),
          lastPushedHash: contentHash(item),
          lastPushedAt: new Date(),
          syncBaselineHash: syncContentHash(item),
          syncBaselineMetaHash: syncMetaHash(item),
          syncBaselineVariantsHash: variantsFingerprint(item.variants),
          syncBaselineQty: item.quantity,
          syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
        },
      });
      if (!live) {
        results.push({
          provider,
          ok: false,
          error: result.warning ?? "Created as a draft — it is not live yet.",
        });
        continue;
      }
      results.push({ provider, ok: true });
    } catch (e) {
      const msg = describeChannelSyncError(provider, e);
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

  // Load member sync preferences
  const memberId = links[0]?.connection?.memberId;
  const syncPrefs = memberId ? await loadSyncPreferences(memberId) : null;
  
  // If sync is globally disabled, skip all channels
  if (syncPrefs && !syncPrefs.syncEnabled) {
    return results;
  }
  
  // If all content sync toggles are disabled, still push inventory (qty / variants).
  if (syncPrefs && !syncPrefs.syncTitles && !syncPrefs.syncDescriptions && !syncPrefs.syncPhotos && !syncPrefs.syncPrices) {
    console.log("[channels] content toggles off — inventory-only push", { storeItemId });
    return syncInventoryToChannels(storeItemId, {
      skipProviders: [...skip],
    });
  }

  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    if (skip.has(provider)) continue;

    const varFp = variantsFingerprint(item.variants);
    const inventoryDrift =
      link.syncBaselineQty !== item.quantity ||
      (link.syncBaselineVariantsHash ?? "") !== varFp;
    const contentUnchanged = link.lastPushedHash === hash;

    if (contentUnchanged && !inventoryDrift) continue;

    // Quantity / variant stock changed but title/price/etc. unchanged — push inventory only.
    if (contentUnchanged && inventoryDrift) {
      const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
      const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
      if (syncDirection === "pull_only" || syncDirection === "paused") continue;

      hydrateCircuitFromConfig(link.connectionId, link.connection.config);
      if (isCircuitOpen(link.connectionId)) {
        results.push({
          provider,
          ok: false,
          error: "Channel sync temporarily paused due to repeated failures",
        });
        continue;
      }

      try {
        const freshItem = await loadSyncItem(storeItemId);
        if (!freshItem) continue;
        const channelInventoryOffset = (connConfig.inventoryOffset as number) ?? 0;
        const globalSafetyBuffer = syncPrefs?.safetyBuffer ?? 0;
        const adjustedQty = Math.max(0, freshItem.quantity - globalSafetyBuffer - channelInventoryOffset);
        await withConnectionAuthRetry(link.connection, (ctx) => {
          const adapter = getAdapter(provider);
          return adapter.updateInventory(ctx, link.externalListingId, adjustedQty, freshItem);
        });
        await prisma.channelListingLink.update({
          where: { id: link.id },
          data: {
            syncStatus: "synced",
            syncError: null,
            lastPushedAt: new Date(),
            syncBaselineVariantsHash: varFp,
            syncBaselineQty: freshItem.quantity,
            syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
          },
        });
        await recordCircuitSuccess(link.connectionId, provider, link.connection.memberId);
        results.push({ provider, ok: true });
      } catch (e) {
        const msg = describeChannelSyncError(provider, e);
        await prisma.channelListingLink
          .update({
            where: { id: link.id },
            data: { syncStatus: "error", syncError: msg },
          })
          .catch(() => {});
        await recordCircuitFailure(link.connectionId, provider, link.connection.memberId, msg);
        enqueueRetry(link.id, storeItemId, provider, "inventory", msg, e).catch(() => {});
        results.push({ provider, ok: false, error: msg });
      }
      continue;
    }

    // Check per-channel sync direction from config
    const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
    const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
    
    // Skip push if channel is set to pull_only or paused
    if (syncDirection === "pull_only" || syncDirection === "paused") {
      continue;
    }

    hydrateCircuitFromConfig(link.connectionId, link.connection.config);
    if (isCircuitOpen(link.connectionId)) {
      logSyncEvent(
        link.connection.memberId,
        provider,
        "circuit_open",
        "Content push skipped - channel temporarily unavailable",
        storeItemId
      );
      results.push({
        provider,
        ok: false,
        error: "Channel sync temporarily paused due to repeated failures",
      });
      continue;
    }

    try {
      await withConnectionAuthRetry(link.connection, async (ctx) => {
        const adapter = getAdapter(provider);
        
        // Apply per-channel price adjustment
        const priceAdjustmentPercent = (connConfig.priceAdjustmentPercent as number) ?? 0;
        const adjustedItem = applyPriceAdjustment(item, priceAdjustmentPercent);
        
        await adapter.updateListing(ctx, link.externalListingId, adjustedItem);
      });
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
      await recordCircuitSuccess(link.connectionId, provider, link.connection.memberId);
      results.push({ provider, ok: true });
    } catch (e) {
      const msg = describeChannelSyncError(provider, e);
      console.error("[channels] updateListing failed", {
        storeItemId,
        provider: link.provider,
        error: msg,
      });
      captureChannelSyncError(e, { provider, storeItemId, connectionId: link.connectionId, operation: "push_content" });
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { syncStatus: "error", syncError: msg },
        })
        .catch(() => {});
      await recordCircuitFailure(link.connectionId, provider, link.connection.memberId, msg);
      enqueueRetry(link.id, storeItemId, provider, "content", msg, e).catch(() => {});
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
      await withConnectionAuthRetry(link.connection, (ctx) => {
        const adapter = getAdapter(provider);
        return adapter.deleteListing(ctx, link.externalListingId);
      });
      results.push({ provider, ok: true });
    } catch (e) {
      const msg = describeChannelSyncError(provider, e);
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
