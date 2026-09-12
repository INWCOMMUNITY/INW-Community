import { waitUntil } from "@vercel/functions";
import { prisma, Prisma } from "database";
import { getAdapter } from "./registry";
import { withConnectionAuthRetry } from "./connection";
import { assertSaneInventoryQty, clampSaneInventoryQty } from "./inventory-sanity";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import { isMadeToOrderTracking, MTO_CHANNEL_QUANTITY } from "@/lib/listing-variant-matrix";
import type { ChannelProvider, ChannelSyncResult } from "./types";
import { describeChannelSyncError } from "./ebay/errors";
import { enqueueRetry } from "./retry-queue";
import { logSyncEvent } from "./sync-log";
import { captureChannelSyncError } from "./sentry";
import { isRemoteListingAlreadyGoneError } from "./error-classifier";
import { persistRemoteListingGoneOnPush, shouldSkipEndedEbayOutbound } from "./listing-link-flags";
import {
  isCircuitOpen,
  recordCircuitSuccess,
  recordCircuitFailure,
  hydrateCircuitFromConfig,
} from "./circuit-breaker";
import { shouldBypassCircuitForInventoryPush } from "./circuit-inventory-bypass";
import {
  inwRevisionCameFromChannelInbound,
  inwSavedAfterChannelPush,
  shouldBlockOutboundQtyOverwrite,
} from "./sync-baseline";
import { fetchEbayItemDetails } from "./ebay/trading";
import { resolveEbayLegacyListingId } from "./ebay/mapping";
import { fetchEtsyListingForInbound } from "./etsy/listing-exists";
import { fetchShopifyListingForInbound } from "./shopify/adapter";
import { withLastInventoryPushAt, readEbayPendingVariantInboundHash } from "./listing-conflict-json";
import { variantsFingerprint, inventoryVariantsBaselineMatches, remoteSkuQuantitiesDivergeFromInw } from "./variant-sync";

/**
 * Push the StoreItem's current (authoritative) quantity out to every linked channel as an
 * ABSOLUTE value, so all channels converge regardless of where the sale happened. Idempotent:
 * safe to call after a sale on any channel, including the originating one.
 */
export type ChannelSyncOptions = {
  /** Skip pushing to these providers (e.g. Wix already has the new qty after an inbound edit). */
  skipProviders?: ChannelProvider[];
  /**
   * Skip drift / inbound-echo gates. Used after eBay GetItem applied per-SKU qty so the
   * Inventory API catches up with Trading (otherwise Seller Hub snaps qty back).
   */
  force?: boolean;
};

export async function syncInventoryToChannels(
  storeItemId: string,
  options: ChannelSyncOptions = {}
): Promise<ChannelSyncResult[]> {
  const skip = new Set(options.skipProviders ?? []);
  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId, syncEnabled: true },
    include: { connection: true },
  });
  const results: ChannelSyncResult[] = [];
  if (links.length === 0) return results;

  // Load member sync preferences for safety buffer and zero quantity handling
  const memberId = links[0]?.connection?.memberId;
  let globalSafetyBuffer = 0;
  let syncEnabled = true;
  let syncZeroQuantity = true;
  let lowStockAlertThreshold = 0;
  if (memberId) {
    const syncPrefs = await prisma.memberSyncPreferences.findUnique({
      where: { memberId },
      select: { safetyBuffer: true, syncEnabled: true, syncZeroQuantity: true, lowStockAlertThreshold: true },
    });
    globalSafetyBuffer = syncPrefs?.safetyBuffer ?? 0;
    syncEnabled = syncPrefs?.syncEnabled ?? true;
    syncZeroQuantity = syncPrefs?.syncZeroQuantity ?? true;
    lowStockAlertThreshold = syncPrefs?.lowStockAlertThreshold ?? 0;
  }

  // If sync is globally disabled, skip all channels
  if (!syncEnabled) {
    return results;
  }

  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    if (skip.has(provider)) continue;
    if (link.connection.status === "disconnected" || link.connection.status === "revoked") {
      results.push({ provider, ok: true, skipped: "sync_disabled" });
      continue;
    }
    if (shouldSkipEndedEbayOutbound(provider, link.conflictDetails)) {
      results.push({ provider, ok: true });
      continue;
    }
    if (provider === "ebay" && readEbayPendingVariantInboundHash(link.conflictDetails)) {
      results.push({ provider, ok: true, skipped: "pending_inbound" });
      continue;
    }

    hydrateCircuitFromConfig(link.connectionId, link.connection.config);
    if (isCircuitOpen(link.connectionId)) {
      // Load item qty after we know we might skip — cheap path uses connection only.
      const peek = await prisma.storeItem.findUnique({
        where: { id: storeItemId },
        select: { quantity: true, status: true },
      });
      const bypass =
        peek &&
        shouldBypassCircuitForInventoryPush({
          quantity: peek.quantity,
          status: peek.status,
          adjustedQty: Math.max(0, peek.quantity),
        });
      if (!bypass) {
        logSyncEvent(
          link.connection.memberId,
          provider,
          "circuit_open",
          "Sync skipped - channel temporarily unavailable",
          storeItemId
        );
        results.push({
          provider,
          ok: false,
          error: "Channel sync temporarily paused due to repeated failures",
        });
        continue;
      }
    }

    // Check per-channel sync direction from config
    const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
    const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
    
    // Skip push if channel is set to pull_only or paused
    if (syncDirection === "pull_only" || syncDirection === "paused") {
      continue;
    }

    let storeItemStatus: string | undefined;
    try {
      const freshItem = await prisma.storeItem.findUnique({
        where: { id: storeItemId },
        select: { ...syncStoreItemSelect, updatedAt: true },
      });
      if (!freshItem) continue;
      storeItemStatus = freshItem.status;
      const adapter = getAdapter(provider);
      const item = toSyncStoreItem(freshItem);
      
      // Apply safety buffer: global + per-channel inventory offset
      const channelInventoryOffset = (connConfig.inventoryOffset as number) ?? 0;
      const totalBuffer = isMadeToOrderTracking(item.inventoryTracking)
        ? 0
        : globalSafetyBuffer + channelInventoryOffset;
      const adjustedQty = isMadeToOrderTracking(item.inventoryTracking)
        ? MTO_CHANNEL_QUANTITY
        : Math.max(0, item.quantity - totalBuffer);
      const forceZeroForSoldOut = item.status === "sold_out" && adjustedQty === 0;

      // If syncZeroQuantity is disabled and qty is 0, skip pushing to channels
      // unless the listing is sold_out — sell-out must still take sibling listings down.
      if (!syncZeroQuantity && adjustedQty === 0 && !forceZeroForSoldOut) {
        logSyncEvent(
          link.connection.memberId,
          provider,
          "skip_zero_qty",
          "Zero push skipped (syncZeroQuantity disabled)",
          storeItemId
        );
        await prisma.channelListingLink
          .update({
            where: { id: link.id },
            data: { syncError: "Zero push skipped (syncZeroQuantity disabled)" },
          })
          .catch(() => {});
        continue;
      }
      
      const qty = assertSaneInventoryQty(adjustedQty, `syncInventory(${provider})`);

      // Drift gate.  syncBaselineQty records the RAW hub quantity (item.quantity)
      // at the time of the last successful push.  Compare against the hub qty —
      // NOT the buffer-adjusted `qty` — so the baseline stays consistent with
      // writeBaseline (reconcile) and the outbound inventoryOnly path, both of
      // which write item.quantity.  When a safety buffer or per-channel offset is
      // active, the PUSHED value (qty) differs from item.quantity by the buffer,
      // but that's expected and not a reason to re-push every tick.
      //
      // Also check the variant fingerprint: individual SKU quantities can shift
      // while the total remains unchanged (multi-variation listings). Price-only
      // changes must not count as qty drift (that snaps eBay stock after an inbound price pull).
      const varFp = variantsFingerprint(item.variants);
      const baselineQtyMatches =
        link.syncBaselineQty != null && link.syncBaselineQty === item.quantity;
      const baselineVarMatches = inventoryVariantsBaselineMatches(
        link.syncBaselineVariantsHash,
        item.variants
      );
      if (!options.force && baselineQtyMatches && baselineVarMatches) {
        results.push({ provider, ok: true, skipped: "no_qty_drift" });
        continue;
      }

      if (
        !options.force &&
        provider === "ebay" &&
        inwRevisionCameFromChannelInbound({
          inwUpdatedAt: freshItem.updatedAt,
          lastInboundAt: link.lastInboundAt,
        })
      ) {
        console.info("[channels] skip eBay inventory push; INW revision came from inbound", {
          storeItemId,
          lastInboundAt: link.lastInboundAt?.toISOString() ?? null,
          inwUpdatedAt: freshItem.updatedAt.toISOString(),
        });
        results.push({ provider, ok: true, skipped: "inbound_echo" });
        continue;
      }

      // Sale-revert guard. This absolute-qty push converges stock after a sale, so it must not
      // block legitimate convergence (INW moved off baseline). It ONLY guards the suspicious
      // case: INW is still at the last agreed baseline while the live channel stock has moved —
      // a real sale/edit on the channel that INW has not pulled yet. A live read there prevents
      // re-pushing INW's stale quantity and "un-selling" the item. Exact-compare only (no buffer).
      const qtyGuardExact = totalBuffer === 0;
      const inwAtBaseline =
        link.syncBaselineQty != null && item.quantity === link.syncBaselineQty;
      if (
        !options.force &&
        qtyGuardExact &&
        inwAtBaseline &&
        (provider === "ebay" || provider === "etsy" || provider === "shopify")
      ) {
        const blocked = await withConnectionAuthRetry(link.connection, async (ctx) => {
          if (provider === "ebay") {
            const legacyId = resolveEbayLegacyListingId(link.externalListingId);
            if (!legacyId) return false;
            const live = await fetchEbayItemDetails(ctx.accessToken, legacyId).catch(() => null);
            if (!live) return false;
            if (
              live.quantity != null &&
              shouldBlockOutboundQtyOverwrite({
                inwQuantity: item.quantity,
                remoteQuantity: live.quantity,
                syncBaselineQty: link.syncBaselineQty,
                remoteUpdatedAt: live.remoteUpdatedAt ?? null,
                inwUpdatedAt: freshItem.updatedAt,
                lastPushedAt: link.lastPushedAt,
              })
            ) {
              return true;
            }
            return (
              !inwSavedAfterChannelPush({
                inwUpdatedAt: freshItem.updatedAt,
                lastPushedAt: link.lastPushedAt,
              }) &&
              remoteSkuQuantitiesDivergeFromInw({
                inwVariants: item.variants,
                remoteVariants: live.variants,
              })
            );
          }
          if (provider === "shopify") {
            const fetched = await fetchShopifyListingForInbound(
              ctx,
              link.externalListingId
            ).catch(() => null);
            if (!fetched || fetched.status !== "ok" || fetched.summary.quantityKnown === false) {
              return false;
            }
            return shouldBlockOutboundQtyOverwrite({
              inwQuantity: item.quantity,
              remoteQuantity: fetched.summary.quantity,
              syncBaselineQty: link.syncBaselineQty,
              remoteUpdatedAt: fetched.summary.remoteUpdatedAt ?? null,
              inwUpdatedAt: freshItem.updatedAt,
              lastPushedAt: link.lastPushedAt,
            });
          }
          const fetched = await fetchEtsyListingForInbound(
            ctx.accessToken,
            link.externalListingId
          ).catch(() => null);
          if (!fetched || fetched.status !== "ok" || fetched.summary.quantityKnown === false) {
            return false;
          }
          return shouldBlockOutboundQtyOverwrite({
            inwQuantity: item.quantity,
            remoteQuantity: fetched.summary.quantity,
            syncBaselineQty: link.syncBaselineQty,
            remoteUpdatedAt: fetched.summary.remoteUpdatedAt ?? null,
            inwUpdatedAt: freshItem.updatedAt,
            lastPushedAt: link.lastPushedAt,
          });
        });
        if (blocked) {
          console.warn("[channels] skip inventory push; live stock is newer than INW (at baseline)", {
            storeItemId,
            provider,
            externalListingId: link.externalListingId,
            inwQty: item.quantity,
            syncBaselineQty: link.syncBaselineQty,
          });
          results.push({ provider, ok: true, skipped: "remote_newer" });
          continue;
        }
      }

      await withConnectionAuthRetry(link.connection, (ctx) =>
        adapter.updateInventory(ctx, link.externalListingId, qty, item)
      );
      // Write baseline as the RAW hub qty (item.quantity), not the buffer-adjusted
      // `qty`.  Every other baseline writer (writeBaseline in reconcile, and the
      // outbound inventoryOnly path) records the raw hub qty.  When the baseline
      // tracks raw qty, the drift gate above (item.quantity !== syncBaselineQty)
      // only fires when the hub genuinely changed — not every tick because of a
      // safety buffer offset.  Also stamp the variant fingerprint so individual-SKU
      // quantity changes are detected on the next pass.
      const rawBaselineQty = clampSaneInventoryQty(item.quantity);
      const pushNow = new Date();
      const updatedConflict = withLastInventoryPushAt(
        link.conflictDetails, pushNow
      ) as Prisma.InputJsonValue;
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          syncStatus: "synced",
          syncError: null,
          // Qty-only writes must not stamp lastPushedAt / syncBaselineAt — those
          // timestamps are content-inbound floors and were hiding eBay/Etsy edits.
          ...(rawBaselineQty != null ? { syncBaselineQty: rawBaselineQty } : {}),
          syncBaselineVariantsHash: varFp,
          conflictDetails: updatedConflict,
        },
      });
      await recordCircuitSuccess(link.connectionId, provider, link.connection.memberId);
      logSyncEvent(link.connection.memberId, provider, "push_inventory", `qty=${qty}`, storeItemId);
      
      // Check low stock alert threshold (only log once per sync cycle, on first provider)
      if (lowStockAlertThreshold > 0 && item.quantity <= lowStockAlertThreshold && results.length === 0) {
        logSyncEvent(
          link.connection.memberId,
          "inwc" as ChannelProvider,
          "low_stock_alert",
          `Item quantity (${item.quantity}) is at or below alert threshold (${lowStockAlertThreshold})`,
          storeItemId
        );
      }
      
      results.push({ provider, ok: true });
    } catch (e) {
      if (isRemoteListingAlreadyGoneError(e)) {
        await persistRemoteListingGoneOnPush({
          linkId: link.id,
          conflictDetails: link.conflictDetails,
          provider,
          storeItemStatus,
        });
        logSyncEvent(
          link.connection.memberId,
          provider,
          "push_inventory",
          "remote listing already gone; skipped",
          storeItemId
        );
        results.push({ provider, ok: true });
        continue;
      }
      const msg = describeChannelSyncError(provider, e);
      console.error("[channels] inventory sync failed", {
        storeItemId,
        provider: link.provider,
        error: msg,
      });
      captureChannelSyncError(e, { provider, storeItemId, connectionId: link.connectionId, operation: "push_inventory" });
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { syncStatus: "error", syncError: msg },
        })
        .catch(() => {});
      await recordCircuitFailure(link.connectionId, provider, link.connection.memberId, e);
      enqueueRetry(link.id, storeItemId, provider, "inventory", msg, e).catch(() => {});
      logSyncEvent(link.connection.memberId, provider, "error", `Inventory push failed: ${msg}`, storeItemId);
      results.push({ provider, ok: false, error: msg });
    }
  }
  return results;
}

export function channelSyncSucceeded(
  results: ChannelSyncResult[],
  provider: ChannelProvider
): boolean {
  const row = results.find((r) => r.provider === provider);
  if (!row) return true;
  return row.ok;
}

/**
 * Schedule channel inventory push after a local sale/refund. Uses Vercel waitUntil so the work
 * completes after the webhook responds (plain fire-and-forget is often killed on serverless).
 */
export function syncInventoryToChannelsSafe(
  storeItemId: string,
  options: ChannelSyncOptions = {}
): void {
  const work = syncInventoryToChannels(storeItemId, options).catch((e) =>
    console.error("[channels] syncInventoryToChannelsSafe", { storeItemId, error: String(e) })
  );
  if (process.env.VERCEL) {
    waitUntil(work);
    return;
  }
  void work;
}

/** Await inventory push (use when the caller must finish before returning). */
export function syncInventoryToChannelsAfterSale(
  storeItemId: string,
  options: ChannelSyncOptions = {}
): Promise<ChannelSyncResult[]> {
  return syncInventoryToChannels(storeItemId, options).catch((e) => {
    console.error("[channels] syncInventoryToChannelsAfterSale", { storeItemId, error: String(e) });
    return [];
  });
}
