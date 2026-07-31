import { prisma } from "database";
import { getConnectionContext } from "./connection";
import {
  applyRemoteContentToStoreItem,
  applyRemoteListingRemoved,
} from "./apply-remote-listing";
import { getAdapter } from "./registry";
import { updateStoreItemOnChannels } from "./outbound";
import { channelSyncSucceeded, syncInventoryToChannels } from "./sync-inventory";
import {
  resolveSyncDirection,
  syncContentHash,
  syncMetaHash,
  SYNC_ECHO_SKEW_MS,
  type SyncDirection,
} from "./sync-baseline";
import { clampSaneInventoryQty } from "./inventory-sanity";
import { variantsFingerprint } from "./variant-sync";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import { getChannelCapabilities } from "./capabilities";
import { logSyncEvent } from "./sync-log";

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

type LinkRow = {
  id: string;
  storeItemId: string;
  externalListingId: string;
  syncBaselineHash: string | null;
  syncBaselineQty: number | null;
  syncBaselineAt: Date | null;
  storeItem: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
    quantity: number;
    updatedAt: Date;
  };
};

/** Recompute and persist the agreed baseline from the StoreItem's current state. */
async function writeBaseline(
  linkId: string,
  storeItemId: string,
  remote: RemoteListingSummary | null,
  pushed: boolean
): Promise<void> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      title: true,
      description: true,
      photos: true,
      priceCents: true,
      quantity: true,
      category: true,
      subcategory: true,
      secondaryCategory: true,
      shippingCostCents: true,
      variants: true,
    },
  });
  if (!item) return;
  const hash = syncContentHash(item);
  const metaHash = syncMetaHash(item);
  const baselineAt = pushed
    ? new Date(Date.now() + SYNC_ECHO_SKEW_MS)
    : remote?.remoteUpdatedAt ?? new Date();
  await prisma.channelListingLink
    .update({
      where: { id: linkId },
      data: {
        syncBaselineHash: hash,
        syncBaselineMetaHash: metaHash,
        syncBaselineVariantsHash: variantsFingerprint(item.variants),
        ...(clampSaneInventoryQty(item.quantity) != null
          ? { syncBaselineQty: clampSaneInventoryQty(item.quantity)! }
          : {}),
        syncBaselineAt: baselineAt,
      },
    })
    .catch((e) => console.error("[channels] write baseline failed", { linkId, error: String(e) }));
}

/**
 * Two-way catalog reconcile for linked products (manual / CHANNEL_CRON_SYNC_ENABLED).
 * Uses most-recent-wins baselines. Providers without honest remoteUpdatedAt still get
 * quantity push-on-divergence; content pull only when remote timestamp is known.
 */
export async function reconcileConnectionInboundCatalog(
  connection: ConnectionRow
): Promise<{ updated: number; removed: number }> {
  const provider = connection.provider as ChannelProvider;
  
  console.log("[channels] reconcileConnectionInboundCatalog starting", {
    connectionId: connection.id,
    provider,
    memberId: connection.memberId,
  });
  
  const caps = getChannelCapabilities(provider);
  if (!caps.supportsBaselineCatalogReconcile) {
    console.log("[channels] provider does not support baseline reconcile", { provider });
    return { updated: 0, removed: 0 };
  }

  const ctx = await getConnectionContext(connection);
  if (!ctx) {
    console.warn("[channels] no connection context available", { connectionId: connection.id });
    return { updated: 0, removed: 0 };
  }

  let remoteList: RemoteListingSummary[];
  try {
    console.log("[channels] fetching remote listings...", { provider });
    remoteList = await getAdapter(provider).listRemoteListings(ctx);
    console.log("[channels] fetched remote listings", { 
      provider, 
      count: remoteList.length,
      sample: remoteList.slice(0, 2).map(l => ({ id: l.externalListingId, title: l.title?.slice(0, 30) })),
    });
  } catch (e) {
    console.error("[channels] inbound catalog list failed", { provider, error: String(e) });
    return { updated: 0, removed: 0 };
  }

  // Empty catalog usually means wrong API version or a transient failure — do not mark all links removed.
  if (remoteList.length === 0) {
    console.warn("[channels] inbound catalog empty — skipping removal detection", {
      connectionId: connection.id,
      provider,
    });
    return { updated: 0, removed: 0 };
  }

  const remoteById = new Map(remoteList.map((r) => [r.externalListingId, r]));

  const links = (await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider, syncEnabled: true },
    select: {
      id: true,
      storeItemId: true,
      externalListingId: true,
      syncBaselineHash: true,
      syncBaselineQty: true,
      syncBaselineAt: true,
      storeItem: {
        select: {
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          updatedAt: true,
        },
      },
    },
  })) as LinkRow[];

  console.log("[channels] found linked listings", {
    connectionId: connection.id,
    provider,
    linksCount: links.length,
    remoteCount: remoteList.length,
  });

  if (links.length === 0) {
    console.log("[channels] no linked listings to sync");
    return { updated: 0, removed: 0 };
  }

  let updated = 0;
  let removed = 0;

  for (const link of links) {
    const remote = remoteById.get(link.externalListingId);

    // Product no longer visible on the channel -> sell out on INW + push 0 to others.
    if (!remote) {
      await applyRemoteListingRemoved(link.storeItemId);
      await syncInventoryToChannels(link.storeItemId, { skipProviders: [provider] });
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
      await writeBaseline(link.id, link.storeItemId, null, false);
      removed += 1;
      continue;
    }

    const item = link.storeItem;
    const remoteQtyKnown = remote.quantityKnown !== false;

    const inwHash = syncContentHash(item);
    const baseHash = link.syncBaselineHash ?? inwHash;
    const baseAt = link.syncBaselineAt ?? remote.remoteUpdatedAt ?? new Date();
    const inwContentChanged = inwHash !== baseHash;
    
    // Check if remote timestamp is newer than baseline
    const remoteTimestampNewer =
      remote.remoteUpdatedAt != null && remote.remoteUpdatedAt.getTime() > baseAt.getTime();
    
    // ALSO check if remote content actually differs from INW
    // This catches changes even when timestamps aren't working correctly
    const remoteContentActuallyDiffers = 
      item.title !== remote.title.slice(0, 200) ||
      item.priceCents !== remote.priceCents ||
      (item.description?.trim() ?? "") !== (remote.description?.trim() ?? "");
    
    // Remote changed if EITHER timestamp is newer OR content actually differs
    const remoteContentChanged = remoteTimestampNewer || remoteContentActuallyDiffers;
    
    const contentDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwContentChanged,
      remoteChanged: remoteContentChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });

    const inwQtyChangedSinceBaseline =
      link.syncBaselineQty != null && item.quantity !== link.syncBaselineQty;
    const qtyDiffers =
      (remoteQtyKnown && remote.quantity !== item.quantity) || inwQtyChangedSinceBaseline;

    // Debug logging for inbound sync - always log to understand what's happening
    const remoteTimestamp = remote.remoteUpdatedAt?.getTime() ?? 0;
    const baseTimestamp = baseAt?.getTime() ?? 0;
    const timeDiff = remoteTimestamp - baseTimestamp;
    
    // Only log when there are potential changes to reduce noise
    if (inwContentChanged || remoteContentChanged || qtyDiffers) {
      console.log("[channels] inbound sync check - CHANGES DETECTED", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        inwContentChanged,
        remoteTimestampNewer,
        remoteContentActuallyDiffers,
        remoteContentChanged,
        contentDecision,
        qtyDiffers,
        baseAt: baseAt?.toISOString(),
        remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString(),
        inwUpdatedAt: item.updatedAt?.toISOString(),
        timeDiffMs: timeDiff,
        hasBaseline: link.syncBaselineHash != null,
        hasBaselineAt: link.syncBaselineAt != null,
        titleDiff: item.title !== remote.title.slice(0, 200),
        priceDiff: item.priceCents !== remote.priceCents,
        remoteTitle: remote.title?.slice(0, 30),
        inwTitle: item.title?.slice(0, 30),
        remotePriceCents: remote.priceCents,
        inwPriceCents: item.priceCents,
        remoteQty: remote.quantity,
        inwQty: item.quantity,
      });
    }

    if (contentDecision === "noop" && !qtyDiffers) {
      if (link.syncBaselineHash == null || link.syncBaselineAt == null) {
        await writeBaseline(link.id, link.storeItemId, remote, false);
      }
      continue;
    }

    // Detailed logging when changes are detected
    console.log("[channels] applying sync changes", {
      storeItemId: link.storeItemId,
      direction: contentDecision,
      qtyDiffers,
      remoteQty: remote.quantity,
      inwQty: item.quantity,
    });

    if (inwContentChanged && remoteContentChanged) {
      const winner = contentDecision === "pull" ? "remote" : "INW";
      logSyncEvent(
        connection.memberId,
        provider,
        "conflict_resolved",
        `Kept ${winner} version. Remote updated ${remote.remoteUpdatedAt?.toISOString() ?? "unknown"}, INW updated ${item.updatedAt.toISOString()}.`,
        link.storeItemId
      );
    }

    let pulledContent = false;
    if (contentDecision === "pull") {
      console.log("[channels] pulling content from remote", {
        storeItemId: link.storeItemId,
        remoteTitle: remote.title,
        remotePriceCents: remote.priceCents,
        remoteDescription: remote.description?.slice(0, 50),
        remotePhotos: remote.photos?.length,
      });
      pulledContent = await applyRemoteContentToStoreItem(link.storeItemId, remote);
      console.log("[channels] pull result", { storeItemId: link.storeItemId, pulledContent });
    }

    let attemptedPush = false;
    let pushOk = false;
    if (contentDecision === "push") {
      attemptedPush = true;
      pushOk = channelSyncSucceeded(
        await updateStoreItemOnChannels(link.storeItemId),
        provider
      );
    } else if (qtyDiffers) {
      attemptedPush = true;
      pushOk = channelSyncSucceeded(
        await syncInventoryToChannels(link.storeItemId),
        provider
      );
    }

    if (pulledContent && contentDecision !== "push") {
      await updateStoreItemOnChannels(link.storeItemId, { skipProviders: [provider] });
    }

    if (pulledContent) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
    }
    if (attemptedPush && pushOk) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastPushedAt: new Date() },
      });
    }

    if (pulledContent || (attemptedPush && pushOk)) {
      await writeBaseline(link.id, link.storeItemId, remote, attemptedPush && pushOk);
    } else if (link.syncBaselineHash == null || link.syncBaselineAt == null) {
      await writeBaseline(link.id, link.storeItemId, remote, false);
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
