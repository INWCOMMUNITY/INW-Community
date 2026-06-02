import { prisma } from "database";
import { getAdapter } from "./registry";
import { getConnectionContext } from "./connection";
import { toSyncStoreItem } from "./store-item";
import type { ChannelProvider } from "./types";

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
): Promise<void> {
  const skip = new Set(options.skipProviders ?? []);
  const links = await prisma.channelListingLink.findMany({
    where: { storeItemId, syncEnabled: true },
    include: { connection: true, storeItem: true },
  });
  if (links.length === 0) return;

  for (const link of links) {
    if (skip.has(link.provider as ChannelProvider)) continue;
    try {
      const ctx = await getConnectionContext(link.connection);
      if (!ctx) throw new Error("Channel connection unavailable or needs reconnecting.");
      const adapter = getAdapter(link.provider as ChannelProvider);
      const item = toSyncStoreItem(link.storeItem);
      await adapter.updateInventory(ctx, link.externalListingId, item.quantity, item);
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { syncStatus: "synced", syncError: null, lastPushedAt: new Date() },
      });
    } catch (e) {
      console.error("[channels] inventory sync failed", {
        storeItemId,
        provider: link.provider,
        error: String(e),
      });
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { syncStatus: "error", syncError: String(e).slice(0, 500) },
        })
        .catch(() => {});
    }
  }
}

/** Fire-and-forget wrapper for hot paths (Stripe webhook, refund/cancel) that must never throw. */
export function syncInventoryToChannelsSafe(storeItemId: string): void {
  syncInventoryToChannels(storeItemId).catch((e) =>
    console.error("[channels] syncInventoryToChannelsSafe", { storeItemId, error: String(e) })
  );
}
