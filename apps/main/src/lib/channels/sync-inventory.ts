import { waitUntil } from "@vercel/functions";
import { prisma } from "database";
import { getAdapter } from "./registry";
import { getConnectionContext } from "./connection";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import { syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "./sync-baseline";
import { variantsFingerprint } from "./variant-sync";
import type { ChannelProvider, ChannelSyncResult } from "./types";

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

  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    if (skip.has(provider)) continue;
    try {
      const ctx = await getConnectionContext(link.connection);
      if (!ctx) throw new Error("Channel connection unavailable or needs reconnecting.");
      const freshItem = await prisma.storeItem.findUnique({
        where: { id: storeItemId },
        select: syncStoreItemSelect,
      });
      if (!freshItem) continue;
      const adapter = getAdapter(provider);
      const item = toSyncStoreItem(freshItem);
      await adapter.updateInventory(ctx, link.externalListingId, item.quantity, item);
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          syncStatus: "synced",
          syncError: null,
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
      console.error("[channels] inventory sync failed", {
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
