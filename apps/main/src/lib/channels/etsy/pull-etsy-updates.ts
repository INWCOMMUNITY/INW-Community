import { prisma } from "database";
import { getConnectionContext } from "../connection";
import { getAdapter } from "../registry";
import { enrichEtsyListingSummaryWithInventory } from "./variants";
import {
  applyRemoteContentToStoreItem,
  applyRemoteQuantityToStoreItem,
} from "../apply-remote-listing";
import {
  applyRemoteCategoryToStoreItem,
  applyRemoteVariantsToStoreItem,
} from "../apply-remote-meta";
import { syncContentHash, syncMetaHash } from "../sync-baseline";
import { variantsFingerprint } from "../variant-sync";
import { updateStoreItemOnChannels } from "../outbound";
import { channelSyncSucceeded, syncInventoryToChannels } from "../sync-inventory";
import { inboundContentFanoutKind } from "../listing-link-flags";
import { setEtsyConnectionContext } from "./client";

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

export type EtsyPullResult = {
  storeItemId: string;
  title: string;
  updated: boolean;
  changes: string[];
};

/**
 * Pull latest Etsy listing data into a linked StoreItem.
 */
export async function refreshEtsyListingByStoreItemId(
  storeItemId: string,
  memberId: string
): Promise<EtsyPullResult | null> {
  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId, provider: "etsy" },
    include: {
      storeItem: {
        select: {
          id: true,
          memberId: true,
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          category: true,
          subcategory: true,
          variants: true,
        },
      },
    },
  });

  if (!link?.storeItem || link.storeItem.memberId !== memberId) {
    return null;
  }

  const conn = await prisma.channelConnection.findUnique({
    where: { id: link.connectionId },
  });
  if (!conn || conn.status === "disconnected") {
    return null;
  }

  setEtsyConnectionContext(conn.id);
  const ctx = await getConnectionContext(conn);
  if (!ctx) return null;

  const remoteList = await getAdapter("etsy").listRemoteListings(ctx);
  const remote = remoteList.find((l) => l.externalListingId === link.externalListingId);
  if (!remote) {
    return {
      storeItemId,
      title: link.storeItem.title,
      updated: false,
      changes: [],
    };
  }

  await enrichEtsyListingSummaryWithInventory(ctx.accessToken, remote);

  const storeItem = link.storeItem;
  const changes: string[] = [];

  if (remote.title && remote.title.slice(0, 200) !== storeItem.title) {
    changes.push("title");
  }
  if (remote.description && remote.description !== storeItem.description) {
    changes.push("description");
  }
  if (remote.priceCents > 0 && remote.priceCents !== storeItem.priceCents) {
    changes.push(`price ($${(remote.priceCents / 100).toFixed(2)})`);
  }
  if (remote.quantityKnown !== false && remote.quantity !== storeItem.quantity) {
    changes.push(`quantity (${remote.quantity})`);
  }

  let updated = false;

  const pulledContent = await applyRemoteContentToStoreItem(storeItemId, remote);
  if (pulledContent) {
    updated = true;
    if (!changes.includes("title") && remote.title !== storeItem.title) changes.push("title");
    if (!changes.includes("description")) changes.push("description");
    if (!changes.includes(`price ($${(remote.priceCents / 100).toFixed(2)})`)) {
      if (remote.priceCents !== storeItem.priceCents) {
        changes.push(`price ($${(remote.priceCents / 100).toFixed(2)})`);
      }
    }
  }

  if (remote.quantityKnown !== false && remote.quantity !== storeItem.quantity) {
    const qtyPulled = await applyRemoteQuantityToStoreItem(storeItemId, remote.quantity, {
      provider: "etsy",
      memberId,
    });
    if (qtyPulled) updated = true;
  }

  const catPulled = await applyRemoteCategoryToStoreItem(storeItemId, remote, "etsy");
  if (catPulled) {
    updated = true;
    changes.push("category");
  }

  if (remote.variantsKnown && remote.variants) {
    const varsPulled = await applyRemoteVariantsToStoreItem(storeItemId, remote, "etsy");
    if (varsPulled) {
      updated = true;
      changes.push("variants");
    }
  }

  const refreshedItem = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      title: true,
      description: true,
      photos: true,
      priceCents: true,
      quantity: true,
      status: true,
      category: true,
      subcategory: true,
      secondaryCategory: true,
      shippingCostCents: true,
      variants: true,
    },
  });

  if (!refreshedItem) return null;

  if (updated) {
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        syncBaselineHash: syncContentHash(refreshedItem),
        syncBaselineMetaHash: syncMetaHash(refreshedItem),
        syncBaselineVariantsHash: variantsFingerprint(refreshedItem.variants),
        syncBaselineQty: refreshedItem.quantity,
        syncBaselineAt: remote.remoteUpdatedAt ?? new Date(),
        lastInboundAt: new Date(),
        syncStatus: "synced",
        syncError: null,
      },
    });

    console.log("[etsy] refresh completed", { storeItemId, changes });
    const soldOut =
      refreshedItem.quantity === 0 || refreshedItem.status === "sold_out";
    const fanout = inboundContentFanoutKind({
      contentChange: pulledContent,
      soldOut,
    });
    if (fanout === "inventory") {
      await syncInventoryToChannels(storeItemId, { skipProviders: ["etsy"] });
    } else if (fanout === "content") {
      await updateStoreItemOnChannels(storeItemId, { skipProviders: ["etsy"] });
    }
    return {
      storeItemId,
      title: refreshedItem.title,
      updated: true,
      changes: [...new Set(changes)],
    };
  }

  return {
    storeItemId,
    title: refreshedItem.title,
    updated: false,
    changes: [],
  };
}

/**
 * Pull updates from Etsy for all linked listings on a connection.
 */
export async function pullEtsyUpdatesForConnection(
  connection: ConnectionRow
): Promise<{ updated: EtsyPullResult[]; checked: number }> {
  if (connection.provider !== "etsy") {
    return { updated: [], checked: 0 };
  }

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider: "etsy", syncEnabled: true },
    select: { storeItemId: true },
  });

  if (links.length === 0) {
    return { updated: [], checked: 0 };
  }

  setEtsyConnectionContext(connection.id);
  const results: EtsyPullResult[] = [];

  for (const link of links) {
    try {
      const result = await refreshEtsyListingByStoreItemId(link.storeItemId, connection.memberId);
      if (result?.updated) {
        results.push(result);
      }
    } catch (e) {
      console.error("[etsy] pull update failed", {
        storeItemId: link.storeItemId,
        error: String(e),
      });
    }
  }

  return { updated: results, checked: links.length };
}

/**
 * Push pending INW edits to Etsy for all linked listings on a connection.
 */
export async function pushInwUpdatesToEtsyConnection(
  connection: ConnectionRow
): Promise<{ pushed: number; checked: number }> {
  if (connection.provider !== "etsy") {
    return { pushed: 0, checked: 0 };
  }

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider: "etsy", syncEnabled: true },
    select: { storeItemId: true },
  });

  let pushed = 0;
  for (const link of links) {
    try {
      const ok = channelSyncSucceeded(await updateStoreItemOnChannels(link.storeItemId), "etsy");
      if (ok) pushed += 1;
    } catch (e) {
      console.error("[etsy] push update failed", {
        storeItemId: link.storeItemId,
        error: String(e),
      });
    }
  }

  return { pushed, checked: links.length };
}
