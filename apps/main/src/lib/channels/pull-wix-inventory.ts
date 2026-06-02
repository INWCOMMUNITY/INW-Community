import { prisma } from "database";
import { applyRemoteQuantityToStoreItem } from "./apply-remote-listing";
import { getConnectionContext } from "./connection";
import { getAdapter } from "./registry";
import { syncInventoryToChannels } from "./sync-inventory";
import type { ChannelProvider } from "./types";

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
  config?: unknown;
};

/**
 * Pull live quantity from Wix for linked products (inventory webhooks / manual Wix edits).
 * Does not use the catalog product list (which may have stale or unknown qty).
 */
export async function pullWixInventoryForConnection(
  connection: ConnectionRow,
  productIds?: string[]
): Promise<{ updated: number }> {
  if (connection.provider !== "wix") return { updated: 0 };

  const ctx = await getConnectionContext(connection);
  if (!ctx) return { updated: 0 };

  const adapter = getAdapter("wix");
  if (!adapter.fetchProductQuantity) return { updated: 0 };

  const links = await prisma.channelListingLink.findMany({
    where: {
      connectionId: connection.id,
      provider: "wix" as ChannelProvider,
      syncEnabled: true,
      ...(productIds?.length ? { externalListingId: { in: productIds } } : {}),
    },
    select: { id: true, storeItemId: true, externalListingId: true },
  });

  let updated = 0;
  for (const link of links) {
    try {
      const { quantity, known } = await adapter.fetchProductQuantity(ctx, link.externalListingId);
      if (!known) continue;
      const changed = await applyRemoteQuantityToStoreItem(link.storeItemId, quantity);
      if (!changed) continue;
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
      await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
      updated += 1;
    } catch (e) {
      console.error("[channels] pullWixInventory failed", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        error: String(e),
      });
    }
  }

  if (updated > 0) {
    console.info("[channels] pullWixInventory", { connectionId: connection.id, updated });
  }
  return { updated };
}
