import { prisma } from "database";
import { getConnectionContext } from "../connection";
import { enrichEtsyListingSummaryWithInventory } from "./variants";
import {
  applyRemoteContentToStoreItem,
  applyRemoteQuantityToStoreItem,
} from "../apply-remote-listing";
import {
  applyRemoteCategoryToStoreItem,
  applyRemoteVariantsToStoreItem,
} from "../apply-remote-meta";
import {
  inwChangedSinceBaseline,
  syncContentHash,
  syncMetaHash,
} from "../sync-baseline";
import {
  inboundRefreshShouldPull,
  isOwnChannelPushEcho,
  newerChannelQtyEditShouldPull,
  inboundRefreshShouldPullVariantPrices,
} from "../inbound-catalog-decision";
import { variantsFingerprint, variantPricesFingerprint } from "../variant-sync";
import { updateStoreItemOnChannels } from "../outbound";
import { channelSyncSucceeded, syncInventoryToChannels } from "../sync-inventory";
import { inboundContentFanoutKind } from "../listing-link-flags";
import { isComboInventoryFailedError } from "../combo-sync";
import { etsyGet, setEtsyConnectionContext } from "./client";
import { etsyListingToSummary } from "./mapping";
import { etsyRemoteQuantityIsKnown } from "./listing-exists";
import type { RemoteListingSummary } from "../types";
import { matrixHasKnownSkuPrices } from "@/lib/listing-variant-matrix";
import { readLastPushedVariantPricesHash } from "../listing-conflict-json";

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

export async function fetchEtsyRemoteListingById(
  accessToken: string,
  listingId: string
): Promise<RemoteListingSummary | null> {
  const id = listingId.trim();
  if (!id) return null;
  const listing = await etsyGet<Parameters<typeof etsyListingToSummary>[0]>(
    accessToken,
    `/listings/${encodeURIComponent(id)}?includes=Images`
  ).catch(() => null);
  if (!listing) return null;
  return etsyListingToSummary(listing);
}

export async function refreshEtsyListingByExternalId(
  connection: ConnectionRow,
  externalListingId: string
): Promise<EtsyPullResult | null> {
  const ids = [externalListingId, `inw${externalListingId}`];
  const link = await prisma.channelListingLink.findFirst({
    where: {
      connectionId: connection.id,
      provider: "etsy",
      externalListingId: { in: ids },
    },
    select: { storeItemId: true },
  });
  if (!link) return null;
  return refreshEtsyListingByStoreItemId(link.storeItemId, connection.memberId);
}

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
          updatedAt: true,
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

  const remote = await fetchEtsyRemoteListingById(ctx.accessToken, link.externalListingId);
  if (!remote) {
    return {
      storeItemId,
      title: link.storeItem.title,
      updated: false,
      changes: [],
    };
  }

  const inventoryLoaded = await enrichEtsyListingSummaryWithInventory(
    ctx.accessToken,
    remote,
    ctx.externalShopId
  );
  const qtyKnown = etsyRemoteQuantityIsKnown({
    quantity: remote.quantity,
    quantityKnown: remote.quantityKnown,
    inventoryEnriched: inventoryLoaded,
  });

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
  if (qtyKnown && remote.quantity !== storeItem.quantity) {
    changes.push(`quantity (${remote.quantity})`);
  }

  let updated = false;
  let pulledContent = false;

  // Last-write-wins gate: the webhook / on-demand refresh must not overwrite a newer un-pushed
  // Hub edit, and must not re-apply INW's own push echoing back from Etsy. Mirror the cron guards.
  const inwHash = syncContentHash(storeItem);
  const remoteHash = syncContentHash({
    title: (remote.title ?? "").slice(0, 200),
    description: remote.description,
    priceCents: remote.priceCents,
    photos: remote.photos ?? [],
  });
  const baselineHash = link.syncBaselineHash;
  const inwContentChanged = inwChangedSinceBaseline({
    hashDiffers: baselineHash == null ? false : inwHash !== baselineHash,
    inwUpdatedAt: storeItem.updatedAt,
    baselineAt: link.syncBaselineAt,
  });
  const remoteContentChanged = baselineHash == null ? true : remoteHash !== baselineHash;
  const ownPushEcho = isOwnChannelPushEcho({
    lastPushedAt: link.lastPushedAt,
    remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    inwUpdatedAt: storeItem.updatedAt,
    listingsDisagree: remoteHash !== inwHash,
  });
  const shouldPullContent = inboundRefreshShouldPull({
    inwContentChanged,
    remoteContentChanged,
    inwUpdatedAt: storeItem.updatedAt,
    remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    ownPushEcho,
  });
  const shouldPullQty =
    !ownPushEcho &&
    qtyKnown &&
    newerChannelQtyEditShouldPull({
      remoteQtyKnown: qtyKnown,
      remoteQuantity: remote.quantity,
      inwQuantity: storeItem.quantity,
      inwQtyChangedSinceBaseline:
        link.syncBaselineQty != null && link.syncBaselineQty !== storeItem.quantity,
      inwUpdatedAt: storeItem.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
      baselineAt: link.syncBaselineAt ?? null,
    });
  const inwVarChanged = inwChangedSinceBaseline({
    hashDiffers:
      link.syncBaselineVariantsHash == null
        ? false
        : variantsFingerprint(storeItem.variants) !== link.syncBaselineVariantsHash,
    inwUpdatedAt: storeItem.updatedAt,
    baselineAt: link.syncBaselineAt,
  });
  const shouldPullPrices = inboundRefreshShouldPullVariantPrices({
    inwVariantsChanged: inwVarChanged,
    remotePricesKnown: Boolean(remote.variantsKnown) && matrixHasKnownSkuPrices(remote.variants),
    remotePriceFingerprint: variantPricesFingerprint(remote.variants),
    inwPriceFingerprint: variantPricesFingerprint(storeItem.variants),
    inwUpdatedAt: storeItem.updatedAt,
    remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    ownPushEcho,
    lastPushedPriceFingerprint: readLastPushedVariantPricesHash(link.conflictDetails),
  });

  if (!shouldPullContent && !shouldPullQty && !shouldPullPrices) {
    console.log("[etsy] refresh skipped; last-write-wins kept the Hub copy (INW newer or echo)", {
      storeItemId,
      inwContentChanged,
      remoteContentChanged,
      ownPushEcho,
      remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString() ?? null,
      inwUpdatedAt: storeItem.updatedAt.toISOString(),
    });
    return { storeItemId, title: storeItem.title, updated: false, changes: [] };
  }

  if (shouldPullContent) {
    pulledContent = await applyRemoteContentToStoreItem(storeItemId, remote);
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

    const catPulled = await applyRemoteCategoryToStoreItem(storeItemId, remote, "etsy");
    if (catPulled) {
      updated = true;
      changes.push("category");
    }

    if (remote.variantsKnown && remote.variants && !isComboInventoryFailedError(link.syncError)) {
      const varsPulled = await applyRemoteVariantsToStoreItem(storeItemId, remote, "etsy");
      if (varsPulled) {
        updated = true;
        changes.push("variants");
      }
    }
  } else if (shouldPullPrices) {
    if (remote.variantsKnown && remote.variants && !isComboInventoryFailedError(link.syncError)) {
      const varsPulled = await applyRemoteVariantsToStoreItem(storeItemId, remote, "etsy");
      if (varsPulled) {
        updated = true;
        changes.push("variant prices");
      }
    }
  }

  if (shouldPullQty && remote.quantity !== storeItem.quantity) {
    const qtyPulled = await applyRemoteQuantityToStoreItem(storeItemId, remote.quantity, {
      provider: "etsy",
      memberId,
    });
    if (qtyPulled) updated = true;
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
    const keepComboError = isComboInventoryFailedError(link.syncError);
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        syncBaselineHash: syncContentHash(refreshedItem),
        syncBaselineMetaHash: syncMetaHash(refreshedItem),
        syncBaselineVariantsHash: variantsFingerprint(refreshedItem.variants),
        syncBaselineQty: refreshedItem.quantity,
        syncBaselineAt: remote.remoteUpdatedAt ?? new Date(),
        lastInboundAt: new Date(),
        syncStatus: keepComboError ? "error" : "synced",
        syncError: keepComboError ? link.syncError : null,
      },
    });

    console.log("[etsy] refresh completed", { storeItemId, changes });
    const soldOut =
      refreshedItem.quantity === 0 || refreshedItem.status === "sold_out";
    const fanout = inboundContentFanoutKind({
      contentChange: pulledContent || changes.includes("variant prices") || changes.includes("variants"),
      soldOut,
    });
    if (fanout === "inventory") {
      await syncInventoryToChannels(storeItemId, { skipProviders: ["etsy"] });
    } else if (fanout === "content") {
      await updateStoreItemOnChannels(storeItemId, {
        skipProviders: ["etsy"],
        sourceUpdatedAt: remote.remoteUpdatedAt ?? undefined,
      });
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
