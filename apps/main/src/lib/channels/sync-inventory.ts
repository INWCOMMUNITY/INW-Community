import { waitUntil } from "@vercel/functions";
import { prisma } from "database";
import { getAdapter } from "./registry";
import { withConnectionAuthRetry } from "./connection";
import { assertSaneInventoryQty, clampSaneInventoryQty } from "./inventory-sanity";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import type { ChannelProvider, ChannelSyncResult } from "./types";
import { describeChannelSyncError } from "./ebay/errors";
import { enqueueRetry } from "./retry-queue";
import { logSyncEvent } from "./sync-log";
import { captureChannelSyncError } from "./sentry";
import {
  isCircuitOpen,
  recordCircuitSuccess,
  recordCircuitFailure,
  hydrateCircuitFromConfig,
} from "./circuit-breaker";

/**
 * Push the StoreItem's current (authoritative) quantity out to every linked channel as an
 * ABSOLUTE value, so all channels converge regardless of where the sale happened. Idempotent:
 * safe to call after a sale on any channel, including the originating one.
 */
export type ChannelSyncOptions = {
  /** Skip pushing to these providers (e.g. Wix already has the new qty after an inbound edit). */
  skipProviders?: ChannelProvider[];
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

    hydrateCircuitFromConfig(link.connectionId, link.connection.config);
    if (isCircuitOpen(link.connectionId)) {
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

    // Check per-channel sync direction from config
    const connConfig = (link.connection.config ?? {}) as Record<string, unknown>;
    const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
    
    // Skip push if channel is set to pull_only or paused
    if (syncDirection === "pull_only" || syncDirection === "paused") {
      continue;
    }

    try {
      const freshItem = await prisma.storeItem.findUnique({
        where: { id: storeItemId },
        select: syncStoreItemSelect,
      });
      if (!freshItem) continue;
      const adapter = getAdapter(provider);
      const item = toSyncStoreItem(freshItem);
      
      // Apply safety buffer: global + per-channel inventory offset
      const channelInventoryOffset = (connConfig.inventoryOffset as number) ?? 0;
      const totalBuffer = globalSafetyBuffer + channelInventoryOffset;
      const adjustedQty = Math.max(0, item.quantity - totalBuffer);
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
      await withConnectionAuthRetry(link.connection, (ctx) =>
        adapter.updateInventory(ctx, link.externalListingId, qty, item)
      );
      const baselineQty = clampSaneInventoryQty(qty);
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          syncStatus: "synced",
          syncError: null,
          // Qty-only writes must not stamp lastPushedAt / syncBaselineAt — those
          // timestamps are content-inbound floors and were hiding eBay/Etsy edits.
          ...(baselineQty != null ? { syncBaselineQty: baselineQty } : {}),
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
      await recordCircuitFailure(link.connectionId, provider, link.connection.memberId, msg);
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
