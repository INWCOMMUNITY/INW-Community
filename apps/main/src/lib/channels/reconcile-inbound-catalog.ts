import { prisma } from "database";
import { getConnectionContext } from "./connection";
import {
  applyRemoteListingRemoved,
  applyRemoteListingToStoreItem,
} from "./apply-remote-listing";
import { getAdapter } from "./registry";
import { updateStoreItemOnChannels } from "./outbound";
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
 * Pull catalog state from Wix for every linked product: quantity, price, title, photos.
 * Deletions on Wix mark the INW listing sold out. Changes propagate to other linked channels.
 */
export async function reconcileConnectionInboundCatalog(
  connection: ConnectionRow
): Promise<{ updated: number; removed: number }> {
  const provider = connection.provider as ChannelProvider;
  if (provider !== "wix") return { updated: 0, removed: 0 };

  const ctx = await getConnectionContext(connection);
  if (!ctx) return { updated: 0, removed: 0 };

  let remoteList;
  try {
    remoteList = await getAdapter(provider).listRemoteListings(ctx);
  } catch (e) {
    console.error("[channels] inbound catalog list failed", { provider, error: String(e) });
    return { updated: 0, removed: 0 };
  }

  const remoteById = new Map(remoteList.map((r) => [r.externalListingId, r]));

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider, syncEnabled: true },
    select: { id: true, storeItemId: true, externalListingId: true },
  });

  let updated = 0;
  let removed = 0;

  for (const link of links) {
    const remote = remoteById.get(link.externalListingId);
    if (!remote) {
      await applyRemoteListingRemoved(link.storeItemId);
      await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
      removed += 1;
      continue;
    }

    const { contentChanged, quantityChanged } = await applyRemoteListingToStoreItem(
      link.storeItemId,
      remote
    );
    if (!contentChanged && !quantityChanged) continue;

    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: { lastInboundAt: new Date() },
    });

    if (quantityChanged) {
      await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
    }
    if (contentChanged) {
      await updateStoreItemOnChannels(link.storeItemId, { skipProviders: ["wix"] });
    }
    updated += 1;
  }

  if (updated > 0 || removed > 0) {
    console.info("[channels] inbound catalog sync", {
      provider,
      connectionId: connection.id,
      updated,
      removed,
    });
  }
  return { updated, removed };
}
