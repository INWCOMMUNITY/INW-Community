import { prisma, Prisma } from "database";
import { getAdapter } from "./registry";
import { getActiveConnectionsForMember, withConnectionAuthRetry, isChannelAuthError } from "./connection";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import {
  inwSavedAfterChannelPush,
  storeItemContentHash,
  shouldBlockOutboundOverwrite,
  shouldBlockEbayOutboundOverwrite,
  shouldBlockOutboundQtyOverwrite,
  syncContentHash,
  syncMetaHash,
  SYNC_ECHO_SKEW_MS,
} from "./sync-baseline";
import { variantsFingerprint, variantPricesFingerprint } from "./variant-sync";
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
import { shouldPushInventoryOnly } from "./sold-out-guard";
import { shouldBypassCircuitForInventoryPush } from "./circuit-inventory-bypass";
import { isMadeToOrderTracking, MTO_CHANNEL_QUANTITY, normalizeVariantMatrix, optionValuesKey, matrixHasKnownSkuPrices } from "@/lib/listing-variant-matrix";
import { recordVariantPriceTrace, buildIntendedVariantPriceRows } from "./sync-trace";
import { isRemoteListingAlreadyGoneError } from "./error-classifier";
import {
  persistRemoteListingGoneOnPush,
  shouldSkipEndedEbayOutbound,
} from "./listing-link-flags";
import { claimChannelListingLink } from "./listing-link-claim";
import { fetchEtsyListingForInbound } from "./etsy/listing-exists";
import { inboundDescriptionsMatch } from "./apply-remote-listing";
import { fetchEbayItemDetails } from "./ebay/trading";
import { fetchShopifyListingForInbound } from "./shopify/adapter";
import { resolveEbayLegacyListingId } from "./ebay/mapping";
import {
  readEbayLastSyncedTitle,
  readEbayPendingVariantInboundHash,
  readLastPushedVariantPricesHash,
  withLastPushedVariantPricesHash,
  readEtsyLastSyncedContent,
  withEtsyLastSyncedContent,
} from "./listing-conflict-json";
import { isIncompleteChannelListingError } from "./combo-sync";
import { channelLinkShowsOnItem } from "./listing-sync-warning";
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

async function loadSyncItemWithUpdatedAt(
  storeItemId: string
): Promise<{ item: SyncStoreItem; updatedAt: Date } | null> {
  const row = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { ...syncStoreItemSelect, updatedAt: true },
  });
  if (!row) return null;
  return { item: toSyncStoreItem(row), updatedAt: row.updatedAt };
}

/**
 * Apply per-channel price adjustment to an item for outbound push.
 * Returns a new item object with adjusted price.
 */
function applyPriceAdjustment(item: SyncStoreItem, adjustmentPercent: number): SyncStoreItem {
  if (adjustmentPercent === 0) return item;

  const multiplier = 1 + (adjustmentPercent / 100);
  const adjustedPrice = Math.round(item.priceCents * multiplier);

  // Scale per-SKU variation prices by the same channel markup. Previously only the
  // listing-level price was adjusted, so variations with explicit prices pushed the raw
  // (unadjusted) amount while the fallback used the adjusted listing price — an inconsistent
  // mix across a listing. Keep INW's baseline fingerprint on the unadjusted `item.variants`;
  // this adjusted copy is only used for the outbound API call.
  const matrix = normalizeVariantMatrix(item.variants);
  const adjustedVariants =
    matrix && matrix.skus.some((s) => s.priceCents != null && s.priceCents > 0)
      ? {
          ...matrix,
          skus: matrix.skus.map((s) =>
            s.priceCents != null && s.priceCents > 0
              ? { ...s, priceCents: Math.max(1, Math.round(s.priceCents * multiplier)) }
              : s
          ),
        }
      : item.variants;

  return {
    ...item,
    priceCents: Math.max(0, adjustedPrice), // Never go negative
    variants: adjustedVariants,
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
    const existingIsLive = Boolean(
      existing &&
        channelLinkShowsOnItem({
          provider,
          externalListingId: existing.externalListingId,
          conflictDetails: existing.conflictDetails,
        })
    );
    if (existing && existingIsLive) {
      if (existing.syncStatus === "error") {
        try {
          const connConfig = (conn.config ?? {}) as Record<string, unknown>;
          const priceAdjustmentPercent = (connConfig.priceAdjustmentPercent as number) ?? 0;
          const cio = (connConfig.inventoryOffset as number) ?? 0;
          const gsb = syncPrefs?.safetyBuffer ?? 0;
          const baq = isMadeToOrderTracking(item.inventoryTracking)
            ? MTO_CHANNEL_QUANTITY
            : Math.max(0, item.quantity - gsb - cio);
          const adjustedItem = { ...applyPriceAdjustment(item, priceAdjustmentPercent), quantity: baq };
          await getAdapter(provider).updateListing(conn, existing.externalListingId, adjustedItem);
          await prisma.channelListingLink.update({
            where: { id: existing.id },
            data: {
              syncStatus: "synced",
              syncError: null,
              lastPushedAt: new Date(),
              lastPushedHash: contentHash(item),
              lastPushedPhotos: item.photos,
            },
          });
          results.push({ provider, ok: true });
        } catch (e) {
          const msg = describeChannelSyncError(provider, e);
          results.push({ provider, ok: false, error: msg });
        }
        continue;
      }
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

    if (existing) {
      await prisma.channelListingLink.delete({ where: { id: existing.id } });
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
      const cio2 = (connConfig.inventoryOffset as number) ?? 0;
      const gsb2 = syncPrefs?.safetyBuffer ?? 0;
      const baq2 = isMadeToOrderTracking(item.inventoryTracking)
        ? MTO_CHANNEL_QUANTITY
        : Math.max(0, item.quantity - gsb2 - cio2);
      const adjustedItem = { ...applyPriceAdjustment(item, priceAdjustmentPercent), quantity: baq2 };

      const result = await adapter.createListing(conn, adjustedItem);
      const live = result.live !== false;
      await claimChannelListingLink({
        storeItemId,
        memberId,
        connectionId: conn.id,
        provider,
        externalListingId: result.externalListingId,
        externalShopId: result.externalShopId,
        ...(provider === "ebay" || provider === "wix" ? { linkOrigin: "inw_create" as const } : {}),
        syncEnabled: true,
        syncStatus: live ? "synced" : "error",
        syncError: live ? null : (result.warning ?? "Created as a draft — it is not live yet."),
        lastPushedHash: contentHash(item),
        lastPushedAt: new Date(),
        lastPushedPhotos: item.photos,
        syncBaselineHash: syncContentHash(item),
        syncBaselineMetaHash: syncMetaHash(item),
        syncBaselineVariantsHash: variantsFingerprint(item.variants),
        syncBaselineQty: item.quantity,
        syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
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
      if (isIncompleteChannelListingError(e)) {
        if (!e.rolledBack) {
          await claimChannelListingLink({
            storeItemId,
            memberId,
            connectionId: conn.id,
            provider,
            externalListingId: e.externalListingId,
            externalShopId: conn.externalShopId,
            ...(provider === "ebay" || provider === "wix" ? { linkOrigin: "inw_create" as const } : {}),
            syncEnabled: true,
            syncStatus: "error",
            syncError: e.message.slice(0, 800),
            lastPushedAt: new Date(),
          }).catch(() => {});
        }
        results.push({
          provider,
          ok: false,
          error: e.message,
          remoteListingExists: !e.rolledBack,
        });
        continue;
      }
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
  /** Push even when lastPushedHash already matches (Needs Attention retry / shop ZIP). */
  force?: boolean;
  /**
   * Timestamp of the inbound source (Shopify updated_at, Etsy last_modified, eBay
   * LastModified) or pre-apply INW. Outbound live-GET guards must not use a
   * post-apply StoreItem.updatedAt restamp from fan-out.
   */
  sourceUpdatedAt?: Date | null;
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
  const loaded = await loadSyncItemWithUpdatedAt(storeItemId);
  if (!loaded) return results;
  const { item, updatedAt: inwUpdatedAt } = loaded;
  const hubUpdatedAt = options.sourceUpdatedAt ?? inwUpdatedAt;
  const hash = contentHash(item);

  // Load member sync preferences
  const memberId = links[0]?.connection?.memberId;
  const syncPrefs = memberId ? await loadSyncPreferences(memberId) : null;
  
  // If sync is globally disabled, skip all channels — but report each so the banner isn't false-green.
  if (syncPrefs && !syncPrefs.syncEnabled) {
    for (const link of links) {
      const provider = link.provider as ChannelProvider;
      if (skip.has(provider)) continue;
      results.push({ provider, ok: true, skipped: "sync_disabled" });
    }
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
    if (skip.has(provider)) {
      continue;
    }
    // A disconnected (or missing-token) connection can never produce a context, so
    // withConnectionAuthRetry throws on every linked item — filling the logs with
    // "Channel connection unavailable" errors. Skip silently.
    if (link.connection.status === "disconnected" || link.connection.status === "revoked") {
      results.push({ provider, ok: true, skipped: "sync_disabled" });
      continue;
    }
    if (shouldSkipEndedEbayOutbound(provider, link.conflictDetails)) {
      results.push({ provider, ok: true });
      continue;
    }
    if (provider === "ebay" && readEbayPendingVariantInboundHash(link.conflictDetails)) {
      console.info("[channels] skip eBay outbound; pending variant inbound", { storeItemId });
      results.push({ provider, ok: true, skipped: "pending_inbound" });
      continue;
    }

    const varFp = variantsFingerprint(item.variants);
    const inventoryDrift =
      link.syncBaselineQty !== item.quantity ||
      (link.syncBaselineVariantsHash ?? "") !== varFp;
    const contentUnchanged = link.lastPushedHash === hash;
    // Per-variation PRICE edits leave the listing-level price (and syncContentHash) unchanged,
    // so they would route to the quantity-only inventory path and never reach Shopify/eBay.
    // Detect them against the last-pushed per-SKU price fingerprint and force a full listing push.
    // A null baseline (never recorded) with per-variation prices forces one full push so the
    // per-SKU prices are established on every channel (Shopify/eBay), then it self-heals.
    const currentPricesFp = variantPricesFingerprint(item.variants);
    const lastPushedPricesFp = readLastPushedVariantPricesHash(link.conflictDetails);
    const variantPricesChanged =
      currentPricesFp !== "" && lastPushedPricesFp !== currentPricesFp;
    // Use hubUpdatedAt (the true source time, which is the remote edit time on an inbound
    // fan-out) consistently with the overwrite guard — otherwise the post-apply now() makes
    // this look "newer than the sibling" and re-pushes a stale copy over a newer sibling edit.
    const savedAfterThisChannel = inwSavedAfterChannelPush({
      inwUpdatedAt: hubUpdatedAt,
      lastPushedAt: link.lastPushedAt,
    });

    if (contentUnchanged && !inventoryDrift && !options.force && !savedAfterThisChannel) {
      if (provider === "ebay") {
        console.info("[channels] skip eBay content push; hash unchanged and INW not newer than lastPushedAt", {
          storeItemId,
          lastPushedAt: link.lastPushedAt?.toISOString() ?? null,
          inwUpdatedAt: inwUpdatedAt.toISOString(),
        });
      }
      continue;
    }

    // Quantity / variant stock changed but title/price/etc. unchanged — push inventory only.
    // After a sale, lastPushedHash also changes (it includes qty/status). Still stay on
    // updateInventory so we do not run eBay passthrough / Etsy content verify for qty 0.
    const inventoryOnly =
      !options.force &&
      !variantPricesChanged &&
      shouldPushInventoryOnly({
        quantity: item.quantity,
        status: item.status,
        contentUnchanged,
        inventoryDrift,
        syncBaselineHash: link.syncBaselineHash,
        contentHashNow: syncContentHash(item),
      });
    if (variantPricesChanged) {
      console.log("[channels] per-variation price change -> full listing push", {
        storeItemId,
        provider,
        externalListingId: link.externalListingId,
      });
    }

    if (inventoryOnly) {
      const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
      const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
      if (syncDirection === "pull_only" || syncDirection === "paused") {
        results.push({ provider, ok: true, skipped: "paused" });
        continue;
      }

      hydrateCircuitFromConfig(link.connectionId, link.connection.config);
      if (
        isCircuitOpen(link.connectionId) &&
        !shouldBypassCircuitForInventoryPush({
          quantity: item.quantity,
          status: item.status,
          adjustedQty: Math.max(0, item.quantity),
        })
      ) {
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
        // The sale-revert guard compares INW qty to the live channel qty directly, so it is
        // only exact when no buffer/offset shifts the pushed value out of INW's space.
        const qtyGuardExact = globalSafetyBuffer === 0 && channelInventoryOffset === 0;
        let skippedNewerRemoteQty = false;
        await withConnectionAuthRetry(link.connection, async (ctx) => {
          const adapter = getAdapter(provider);

          // Sale-revert guard: never push INW's quantity when the live marketplace stock is
          // the newer edit and INW is still at baseline (e.g. a buyer just purchased on the
          // channel). Reuses a live read like the content-push path, but qty-only.
          if (qtyGuardExact && provider === "ebay") {
            const legacyId = resolveEbayLegacyListingId(link.externalListingId);
            if (legacyId) {
              const live = await fetchEbayItemDetails(ctx.accessToken, legacyId).catch(() => null);
              if (
                live &&
                live.quantity != null &&
                shouldBlockOutboundQtyOverwrite({
                  inwQuantity: freshItem.quantity,
                  remoteQuantity: live.quantity,
                  syncBaselineQty: link.syncBaselineQty,
                  remoteUpdatedAt: live.remoteUpdatedAt ?? null,
                  inwUpdatedAt: hubUpdatedAt,
                  lastPushedAt: link.lastPushedAt,
                })
              ) {
                skippedNewerRemoteQty = true;
                console.warn("[channels] skip eBay inventory push; live stock is newer than INW", {
                  storeItemId,
                  externalListingId: link.externalListingId,
                  inwQty: freshItem.quantity,
                  remoteQty: live.quantity,
                  syncBaselineQty: link.syncBaselineQty,
                });
                return;
              }
            }
          } else if (qtyGuardExact && provider === "etsy") {
            const fetched = await fetchEtsyListingForInbound(
              ctx.accessToken,
              link.externalListingId
            ).catch(() => null);
            if (
              fetched &&
              fetched.status === "ok" &&
              fetched.summary.quantityKnown !== false &&
              shouldBlockOutboundQtyOverwrite({
                inwQuantity: freshItem.quantity,
                remoteQuantity: fetched.summary.quantity,
                syncBaselineQty: link.syncBaselineQty,
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt ?? null,
                inwUpdatedAt: hubUpdatedAt,
                lastPushedAt: link.lastPushedAt,
              })
            ) {
              skippedNewerRemoteQty = true;
              console.warn("[channels] skip Etsy inventory push; live stock is newer than INW", {
                storeItemId,
                externalListingId: link.externalListingId,
                inwQty: freshItem.quantity,
                remoteQty: fetched.summary.quantity,
                syncBaselineQty: link.syncBaselineQty,
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt?.toISOString() ?? null,
              });
              return;
            }
          } else if (qtyGuardExact && provider === "shopify") {
            const fetched = await fetchShopifyListingForInbound(
              ctx,
              link.externalListingId
            ).catch(() => null);
            if (
              fetched &&
              fetched.status === "ok" &&
              fetched.summary.quantityKnown !== false &&
              shouldBlockOutboundQtyOverwrite({
                inwQuantity: freshItem.quantity,
                remoteQuantity: fetched.summary.quantity,
                syncBaselineQty: link.syncBaselineQty,
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt ?? null,
                inwUpdatedAt: hubUpdatedAt,
                lastPushedAt: link.lastPushedAt,
              })
            ) {
              skippedNewerRemoteQty = true;
              console.warn("[channels] skip Shopify inventory push; live stock is newer than INW", {
                storeItemId,
                externalListingId: link.externalListingId,
                inwQty: freshItem.quantity,
                remoteQty: fetched.summary.quantity,
                syncBaselineQty: link.syncBaselineQty,
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt?.toISOString() ?? null,
              });
              return;
            }
          }

          return adapter.updateInventory(ctx, link.externalListingId, adjustedQty, freshItem);
        });
        if (skippedNewerRemoteQty) {
          results.push({ provider, ok: true, skipped: "remote_newer" });
          continue;
        }
        await prisma.channelListingLink.update({
          where: { id: link.id },
          data: {
            syncStatus: "synced",
            syncError: null,
            lastPushedHash: contentHash(freshItem),
            lastPushedAt: new Date(),
            syncBaselineVariantsHash: varFp,
            syncBaselineQty: freshItem.quantity,
            syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
            // NOTE: do NOT stamp lastPushedVariantPricesHash here. The inventory-only path
            // never writes per-SKU prices, so recording them as "pushed" would falsely
            // suppress a later real price push and let a stale channel snapshot snap INW back.
            // Only the full updateListing path (which actually writes prices) stamps it.
          },
        });
        await recordCircuitSuccess(link.connectionId, provider, link.connection.memberId);
        results.push({ provider, ok: true });
      } catch (e) {
        if (isRemoteListingAlreadyGoneError(e)) {
          await persistRemoteListingGoneOnPush({
            linkId: link.id,
            conflictDetails: link.conflictDetails,
            provider,
            storeItemStatus: item.status,
          });
          results.push({ provider, ok: true });
          continue;
        }
        const msg = describeChannelSyncError(provider, e);
        await prisma.channelListingLink
          .update({
            where: { id: link.id },
            data: { syncStatus: "error", syncError: msg },
          })
          .catch(() => {});
        await recordCircuitFailure(link.connectionId, provider, link.connection.memberId, e);
        enqueueRetry(link.id, storeItemId, provider, "inventory", msg, e).catch(() => {});
        results.push({ provider, ok: false, error: msg });
      }
      continue;
    }

    // Check per-channel sync direction from config
    const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
    const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
    
    // Skip push if channel is set to pull_only or paused — but report it so the banner is honest.
    if (syncDirection === "pull_only" || syncDirection === "paused") {
      results.push({ provider, ok: true, skipped: "paused" });
      continue;
    }

    hydrateCircuitFromConfig(link.connectionId, link.connection.config);
    if (
      isCircuitOpen(link.connectionId) &&
      !shouldBypassCircuitForInventoryPush({
        quantity: item.quantity,
        status: item.status,
        adjustedQty: Math.max(0, item.quantity),
      })
    ) {
      logSyncEvent(
        link.connection.memberId,
        provider,
        "circuit_open",
        "Content push skipped - channel temporarily unavailable",
        storeItemId
      );
      enqueueRetry(
        link.id,
        storeItemId,
        provider,
        "content",
        "Channel sync temporarily paused due to repeated failures"
      ).catch(() => {});
      results.push({
        provider,
        ok: false,
        error: "Channel sync temporarily paused due to repeated failures",
      });
      continue;
    }

    try {
      let skippedNewerRemote = false;
      let liveTitleCheckFailed = false;
      await withConnectionAuthRetry(link.connection, async (ctx) => {
        const adapter = getAdapter(provider);
        
        // Apply per-channel price adjustment + inventory buffer
        const priceAdjustmentPercent = (connConfig.priceAdjustmentPercent as number) ?? 0;
        const channelInventoryOffset = (connConfig.inventoryOffset as number) ?? 0;
        const globalSafetyBuffer = syncPrefs?.safetyBuffer ?? 0;
        const bufferAdjustedQty = isMadeToOrderTracking(item.inventoryTracking)
          ? MTO_CHANNEL_QUANTITY
          : Math.max(0, item.quantity - globalSafetyBuffer - channelInventoryOffset);
        const adjustedItem = { ...applyPriceAdjustment(item, priceAdjustmentPercent), quantity: bufferAdjustedQty };

        if (provider === "etsy") {
          const fetched = await fetchEtsyListingForInbound(ctx.accessToken, link.externalListingId);
          if (fetched.status === "ok") {
            const titlesDiffer =
              item.title.trim().slice(0, 200) !== fetched.summary.title.trim().slice(0, 200);
            const pricesDiffer = item.priceCents !== fetched.summary.priceCents;
            const descriptionsDiffer = Boolean(
              fetched.summary.description?.trim() &&
                !inboundDescriptionsMatch(item.description, fetched.summary.description)
            );
            // Only treat the live Etsy listing as "newer" when it is a GENUINE independent
            // seller edit — i.e. it moved off the content we last pushed. Etsy's
            // last_modified_timestamp advances on our own push, so a pure timestamp compare
            // would block legitimate INW/fan-out edits and then let the inbound cron pull the
            // stale Etsy body back (RC-F bounce-back). When we have no recorded baseline yet,
            // allow a push that carries genuinely new content (contentUnchanged === false).
            const etsyBaseline = readEtsyLastSyncedContent(link.conflictDetails);
            const haveEtsyBaseline =
              etsyBaseline.title != null || etsyBaseline.priceCents != null;
            const remoteTitleMovedOffBaseline =
              etsyBaseline.title != null &&
              etsyBaseline.title.trim().slice(0, 140) !==
                fetched.summary.title.trim().slice(0, 140);
            const remotePriceMovedOffBaseline =
              etsyBaseline.priceCents != null &&
              fetched.summary.priceCents !== etsyBaseline.priceCents;
            const remoteIndependentlyEdited = haveEtsyBaseline
              ? remoteTitleMovedOffBaseline || remotePriceMovedOffBaseline
              : contentUnchanged;
            if (
              remoteIndependentlyEdited &&
              shouldBlockOutboundOverwrite({
                titlesDiffer,
                pricesDiffer,
                descriptionsDiffer,
                inwUpdatedAt: hubUpdatedAt,
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt ?? null,
                lastPushedAt: link.lastPushedAt,
              })
            ) {
              skippedNewerRemote = true;
              console.warn("[channels] skip Etsy content push; live listing is newer than INW", {
                storeItemId,
                externalListingId: link.externalListingId,
                inwTitle: item.title.slice(0, 40),
                remoteTitle: fetched.summary.title.slice(0, 40),
                inwPriceCents: item.priceCents,
                remotePriceCents: fetched.summary.priceCents,
                hubUpdatedAt: hubUpdatedAt.toISOString(),
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt?.toISOString() ?? null,
              });
              return;
            }
          }
        }

        if (provider === "ebay") {
          const legacyId = resolveEbayLegacyListingId(link.externalListingId);
          if (legacyId) {
            try {
              const live = await fetchEbayItemDetails(ctx.accessToken, legacyId);
              if (!live.title) {
                skippedNewerRemote = true;
                liveTitleCheckFailed = true;
                console.warn("[channels] skip eBay content push; live-title GetItem returned no title", {
                  storeItemId,
                  externalListingId: link.externalListingId,
                });
                return;
              }
              if (
                shouldBlockEbayOutboundOverwrite({
                  inwTitle: item.title,
                  remoteTitle: live.title,
                  lastSyncedTitle: readEbayLastSyncedTitle(link.conflictDetails),
                  inwUpdatedAt: hubUpdatedAt,
                  lastPushedAt: link.lastPushedAt,
                  remoteUpdatedAt: live.remoteUpdatedAt ?? null,
                  inwMatchesLastPushedHash: Boolean(link.lastPushedHash && link.lastPushedHash === hash),
                  inwQuantity: item.quantity,
                  remoteQuantity: live.quantity,
                  syncBaselineQty: link.syncBaselineQty,
                  inwDescription: item.description,
                  remoteDescription: live.description,
                })
              ) {
                skippedNewerRemote = true;
                console.warn("[channels] skip eBay content push; live listing is newer than INW", {
                  storeItemId,
                  externalListingId: link.externalListingId,
                  inwTitle: item.title.slice(0, 40),
                  remoteTitle: live.title.slice(0, 40),
                  lastSyncedTitle: readEbayLastSyncedTitle(link.conflictDetails),
                  inwUpdatedAt: hubUpdatedAt.toISOString(),
                  remoteUpdatedAt: live.remoteUpdatedAt?.toISOString() ?? null,
                  inwQuantity: item.quantity,
                  remoteQuantity: live.quantity,
                });
                return;
              }
            } catch (e) {
              if (isChannelAuthError("ebay", e)) throw e;
              skippedNewerRemote = true;
              liveTitleCheckFailed = true;
              console.warn("[channels] skip eBay content push; live-title check failed", {
                storeItemId,
                error: e instanceof Error ? e.message : String(e),
              });
              return;
            }
          }
        }

        if (provider === "shopify") {
          // Shopify previously had NO outbound content guard, so hub fan-out could clobber a newer
          // Shopify admin edit. Block only when the live Shopify listing genuinely differs and was
          // updated after the hub source time — and only when INW is not itself pushing new content
          // (contentUnchanged), mirroring the Etsy no-baseline fallback so real INW edits still win.
          const fetched = await fetchShopifyListingForInbound(ctx, link.externalListingId).catch(
            () => null
          );
          if (fetched && fetched.status === "ok") {
            const titlesDiffer =
              item.title.trim().slice(0, 255) !== fetched.summary.title.trim().slice(0, 255);
            const pricesDiffer = item.priceCents !== fetched.summary.priceCents;
            if (
              contentUnchanged &&
              shouldBlockOutboundOverwrite({
                titlesDiffer,
                pricesDiffer,
                inwUpdatedAt: hubUpdatedAt,
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt ?? null,
                lastPushedAt: link.lastPushedAt,
              })
            ) {
              skippedNewerRemote = true;
              console.warn("[channels] skip Shopify content push; live listing is newer than INW", {
                storeItemId,
                externalListingId: link.externalListingId,
                inwTitle: item.title.slice(0, 40),
                remoteTitle: fetched.summary.title.slice(0, 40),
                inwPriceCents: item.priceCents,
                remotePriceCents: fetched.summary.priceCents,
                hubUpdatedAt: hubUpdatedAt.toISOString(),
                remoteUpdatedAt: fetched.summary.remoteUpdatedAt?.toISOString() ?? null,
              });
              return;
            }
          }
        }

        await adapter.updateListing(ctx, link.externalListingId, adjustedItem);
      });
      if (skippedNewerRemote) {
        if (liveTitleCheckFailed) {
          const msg = "eBay live listing check failed; skipped overwrite";
          await prisma.channelListingLink
            .update({
              where: { id: link.id },
              data: { syncStatus: "error", syncError: msg },
            })
            .catch(() => {});
          enqueueRetry(link.id, storeItemId, provider, "content", msg).catch(() => {});
          results.push({ provider, ok: false, error: msg });
        } else {
          // Last-write-wins kept the shop's newer copy. Not a push and not an error — report it
          // as skipped so the UI doesn't show a false-green "synced".
          results.push({ provider, ok: true, skipped: "remote_newer" });
        }
        continue;
      }
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          syncStatus: "synced",
          syncError: null,
          lastPushedHash: hash,
          lastPushedAt: new Date(),
          lastPushedPhotos: item.photos,
          syncBaselineHash: syncContentHash(item),
          syncBaselineMetaHash: syncMetaHash(item),
          syncBaselineVariantsHash: variantsFingerprint(item.variants),
          syncBaselineQty: item.quantity,
          syncBaselineAt: new Date(Date.now() + SYNC_ECHO_SKEW_MS),
          conflictDetails: (provider === "etsy"
            ? withEtsyLastSyncedContent(
                withLastPushedVariantPricesHash(link.conflictDetails, currentPricesFp),
                { title: item.title, priceCents: item.priceCents }
              )
            : withLastPushedVariantPricesHash(
                link.conflictDetails,
                currentPricesFp
              )) as Prisma.InputJsonValue,
        },
      });
      await recordCircuitSuccess(link.connectionId, provider, link.connection.memberId);
      // Variant-price round-trip observability: record the per-SKU prices we intended to
      // write and the push decision, for every provider, in one place. `dump-variant-trace`
      // reads this back so we can see exactly what INW sent when a variation misbehaves.
      if (matrixHasKnownSkuPrices(item.variants)) {
        const intended = normalizeVariantMatrix(item.variants);
        if (intended) {
          recordVariantPriceTrace({
            memberId: link.connection.memberId,
            provider,
            storeItemId,
            direction: "outbound",
            decision: variantPricesChanged ? "full-push:variant-price-change" : "full-push",
            rows: buildIntendedVariantPriceRows(intended.skus, optionValuesKey),
          });
        }
      }
      results.push({ provider, ok: true });
    } catch (e) {
      if (isRemoteListingAlreadyGoneError(e)) {
        await persistRemoteListingGoneOnPush({
          linkId: link.id,
          conflictDetails: link.conflictDetails,
          provider,
          storeItemStatus: item.status,
        });
        results.push({ provider, ok: true });
        continue;
      }
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
      await recordCircuitFailure(link.connectionId, provider, link.connection.memberId, e);
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
  if (links.length === 0 && providers?.length) {
    return providers.map((provider) => ({
      provider,
      ok: false,
      error: "This item is not listed on that store.",
    }));
  }
  const results: ChannelSyncResult[] = [];
  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    try {
      await withConnectionAuthRetry(link.connection, (ctx) => {
        const adapter = getAdapter(provider);
        return adapter.deleteListing(ctx, link.externalListingId);
      });
      await prisma.channelListingLink.delete({ where: { id: link.id } }).catch(() => {});
      results.push({ provider, ok: true });
    } catch (e) {
      if (isRemoteListingAlreadyGoneError(e)) {
        await prisma.channelListingLink.delete({ where: { id: link.id } }).catch(() => {});
        results.push({ provider, ok: true });
        continue;
      }
      const msg = describeChannelSyncError(provider, e);
      console.error("[channels] deleteListing failed", {
        storeItemId,
        provider: link.provider,
        externalListingId: link.externalListingId,
        error: msg,
      });
      results.push({ provider, ok: false, error: msg });
    }
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
