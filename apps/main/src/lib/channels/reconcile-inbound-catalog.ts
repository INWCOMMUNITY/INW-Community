import { prisma } from "database";
import { getConnectionContext, withConnectionAuthRetry } from "./connection";
import {
  applyRemoteContentToStoreItem,
  applyRemoteQuantityToStoreItem,
  applyRemoteListingRemoved,
  remoteContentDiffersFromStoreItem,
  remoteTitleOrPriceDiffersFromStoreItem,
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
import { indexEbayRemoteListings, resolveEbayLegacyListingId } from "./ebay/mapping";
import { refreshEbayListingByItemId } from "./ebay/pull-ebay-updates";
import { fetchEbayItemDetails } from "./ebay/trading";
import { logSyncEvent } from "./sync-log";

/** Content fingerprint for a remote catalog row (same fields as syncContentHash on StoreItem). */
function remoteListingContentHash(remote: RemoteListingSummary): string {
  return syncContentHash({
    title: remote.title.slice(0, 200),
    description: remote.description,
    priceCents: remote.priceCents,
    photos: remote.photos ?? [],
  });
}

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
 * Two-way catalog reconcile for linked products.
 * Uses most-recent-wins baselines. Providers without honest remoteUpdatedAt still get
 * quantity push-on-divergence. eBay title/price edits are detected from the list payload
 * even when LastModifiedTime is missing, then applied via GetItem.
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
  
  // Check per-channel sync direction from config
  const connConfig = (connection.config ?? {}) as Record<string, unknown>;
  const syncDirection = (connConfig.syncDirection as string) ?? "two_way";
  
  // If sync is paused, skip reconciliation entirely
  if (syncDirection === "paused") {
    console.log("[channels] sync paused for connection", { connectionId: connection.id, provider });
    return { updated: 0, removed: 0 };
  }
  
  // Load member sync preferences
  const memberPrefs = await prisma.memberSyncPreferences.findUnique({
    where: { memberId: connection.memberId },
    select: { 
      syncEnabled: true, 
      conflictResolution: true,
      sourceOfTruth: true,
    },
  });
  
  // Check if sync is globally disabled
  if (memberPrefs && !memberPrefs.syncEnabled) {
    console.log("[channels] sync globally disabled for member", { memberId: connection.memberId });
    return { updated: 0, removed: 0 };
  }
  
  // Get conflict resolution preference (default: most_recent)
  const conflictResolution = (memberPrefs?.conflictResolution ?? "most_recent") as "most_recent" | "inw_wins" | "manual_review";
  
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

  if (links.length === 0) {
    console.log("[channels] no linked listings to sync", {
      connectionId: connection.id,
      provider,
    });
    return { updated: 0, removed: 0 };
  }

  let remoteList: RemoteListingSummary[];
  try {
    console.log("[channels] fetching remote listings...", { provider });
    remoteList = await withConnectionAuthRetry(connection, (ctx) =>
      getAdapter(provider).listRemoteListings(ctx, {
        skipPhotoEnrichment: provider === "ebay",
      })
    );
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
    const connRow = await prisma.channelConnection.findUnique({
      where: { id: connection.id },
      select: { status: true, lastError: true },
    });
    console.warn("[channels] inbound catalog empty — skipping removal detection", {
      connectionId: connection.id,
      provider,
      connectionStatus: connRow?.status,
      ...(connRow?.status === "error" && connRow.lastError
        ? { hint: "Connection may need reconnect — empty catalog can follow auth failure.", lastError: connRow.lastError.slice(0, 200) }
        : {}),
    });
    return { updated: 0, removed: 0 };
  }

  const remoteById =
    provider === "ebay"
      ? indexEbayRemoteListings(remoteList)
      : new Map(remoteList.map((r) => [r.externalListingId, r]));

  // GetMyeBaySelling / Inventory GET can lag minutes behind a revise. Overlay
  // live GetItem title/price/qty for linked listings before we decide pull vs push.
  if (provider === "ebay") {
    for (const link of links) {
      const legacyId =
        resolveEbayLegacyListingId(link.externalListingId) ??
        resolveEbayLegacyListingId(remoteById.get(link.externalListingId)?.externalListingId ?? "");
      if (!legacyId) continue;
      try {
        const details = await fetchEbayItemDetails(ctx.accessToken, legacyId);
        if (details.listingEnded || !details.title) continue;
        const existing = remoteById.get(link.externalListingId);
        const overlaid: RemoteListingSummary = {
          externalListingId: existing?.externalListingId ?? legacyId,
          sku: existing?.sku ?? `inw${legacyId}`,
          title: details.title,
          description: details.description ?? existing?.description ?? null,
          priceCents:
            details.priceCents != null && details.priceCents > 0
              ? details.priceCents
              : existing?.priceCents ?? 0,
          quantity: details.quantity ?? existing?.quantity ?? 0,
          quantityKnown: details.quantity != null ? true : existing?.quantityKnown,
          photos: details.photos.length > 0 ? details.photos : existing?.photos ?? [],
          remoteUpdatedAt: details.remoteUpdatedAt ?? existing?.remoteUpdatedAt ?? null,
          category: existing?.category ?? null,
          remoteCategoryId: details.remoteCategoryId ?? existing?.remoteCategoryId ?? null,
          aspects: details.aspects.length > 0 ? details.aspects : existing?.aspects,
          acceptOffers: details.acceptOffers ?? existing?.acceptOffers,
          minOfferCents: details.minOfferCents ?? existing?.minOfferCents,
          acceptOffersKnown: details.acceptOffers != null || existing?.acceptOffersKnown,
        };
        remoteById.set(link.externalListingId, overlaid);
        remoteById.set(legacyId, overlaid);
        remoteById.set(`inw${legacyId}`, overlaid);
      } catch (e) {
        console.warn("[channels] eBay GetItem hydrate failed", {
          storeItemId: link.storeItemId,
          legacyId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  console.log("[channels] found linked listings", {
    connectionId: connection.id,
    provider,
    linksCount: links.length,
    remoteCount: remoteList.length,
  });

  let updated = 0;
  let removed = 0;

  for (const link of links) {
    const remote = remoteById.get(link.externalListingId);

    // Product no longer visible on the channel -> sell out on INW + push 0 to others.
    // eBay ActiveList can omit a live item while GetItem still succeeds — do not sell out.
    if (!remote) {
      if (provider === "ebay") {
        console.warn("[channels] eBay link missing from seller list after GetItem hydrate; skip sell-out", {
          storeItemId: link.storeItemId,
          externalListingId: link.externalListingId,
        });
        continue;
      }
      const otherChannelLinks = await prisma.channelListingLink.count({
        where: {
          storeItemId: link.storeItemId,
          syncEnabled: true,
          provider: { not: provider },
        },
      });
      if (otherChannelLinks > 0) {
        console.warn("[channels] skip sell-out; listing still linked on another channel", {
          storeItemId: link.storeItemId,
          provider,
          externalListingId: link.externalListingId,
          otherChannelLinks,
        });
        continue;
      }
      if (provider === "etsy") {
        const { etsyListingIsGone } = await import("./etsy/listing-exists");
        const gone = await etsyListingIsGone(ctx.accessToken, link.externalListingId).catch(
          () => false
        );
        if (!gone) {
          console.warn("[channels] skip sell-out; Etsy listing still exists outside active catalog", {
            storeItemId: link.storeItemId,
            externalListingId: link.externalListingId,
          });
          continue;
        }
      }
      const changed = await applyRemoteListingRemoved(link.storeItemId);
      if (!changed) {
        continue;
      }
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
    const remoteHash = remoteListingContentHash(remote);

    // Remote edited on the channel since we last agreed a baseline (timestamp + content hash).
    const remoteTimestampNewer =
      remote.remoteUpdatedAt != null && remote.remoteUpdatedAt.getTime() > baseAt.getTime();
    const ebayListEditVisible =
      provider === "ebay" &&
      !inwContentChanged &&
      remoteTitleOrPriceDiffersFromStoreItem(item, remote);
    const remoteContentChanged =
      (remoteTimestampNewer && remoteHash !== baseHash) || ebayListEditVisible;

    const remoteContentActuallyDiffers = remoteContentDiffersFromStoreItem(item, remote);

    // INW was saved after the remote listing last changed, but Etsy/Wix still shows old data (push pending).
    const inwNewerThanRemote =
      remote.remoteUpdatedAt == null ||
      item.updatedAt.getTime() > remote.remoteUpdatedAt.getTime();
    const staleRemoteNeedsPush =
      !inwContentChanged &&
      !remoteContentChanged &&
      remoteContentActuallyDiffers &&
      inwNewerThanRemote;

    let contentDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwContentChanged,
      remoteChanged: remoteContentChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
      conflictResolution,
    });

    // Hash already matches the agreed baseline — photo-URL / title-truncation drift
    // must not force a full channel rewrite (eBay Inventory PUT #25064 loop).
    if (!inwContentChanged && staleRemoteNeedsPush) {
      contentDecision = "noop";
    }

    // Never pull when the remote listing is older than INW and did not change since baseline.
    if (contentDecision === "pull" && !remoteContentChanged && inwNewerThanRemote) {
      contentDecision = "noop";
    }

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
        ebayListEditVisible,
        staleRemoteNeedsPush,
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
      if (staleRemoteNeedsPush || link.syncBaselineHash == null || link.syncBaselineAt == null) {
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
      if (contentDecision === "noop" && conflictResolution === "manual_review") {
        // Conflict queued for manual review - log but don't auto-resolve
        logSyncEvent(
          connection.memberId,
          provider,
          "conflict_pending",
          `Conflict detected: both INW and ${provider} changed. Queued for manual review. Remote updated ${remote.remoteUpdatedAt?.toISOString() ?? "unknown"}, INW updated ${item.updatedAt.toISOString()}.`,
          link.storeItemId
        );
        // Update link to mark conflict
        await prisma.channelListingLink.update({
          where: { id: link.id },
          data: {
            lastConflictAt: new Date(),
            conflictDetails: {
              inwUpdatedAt: item.updatedAt.toISOString(),
              remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString() ?? null,
              inwTitle: item.title,
              remoteTitle: remote.title,
              inwPriceCents: item.priceCents,
              remotePriceCents: remote.priceCents,
            },
          },
        }).catch(() => {});
      } else {
        const winner = contentDecision === "pull" ? "remote" : "INW";
        logSyncEvent(
          connection.memberId,
          provider,
          "conflict_resolved",
          `Kept ${winner} version (${conflictResolution}). Remote updated ${remote.remoteUpdatedAt?.toISOString() ?? "unknown"}, INW updated ${item.updatedAt.toISOString()}.`,
          link.storeItemId
        );
      }
    }

    let pulledContent = false;
    let pulledQuantity = false;
    let currentQty = item.quantity;
    
    // Respect sync direction for pull operations
    const allowPull = syncDirection === "two_way" || syncDirection === "pull_only";
    const allowPush = syncDirection === "two_way" || syncDirection === "push_only";

    // Recovery: INW was wrongly zeroed/sold out while the channel still has stock.
    // Prefer pulling quantity over pushing zero back to the marketplace.
    const needsQtyRecovery =
      qtyDiffers &&
      remoteQtyKnown &&
      remote.quantity > 0 &&
      currentQty === 0;

    if (needsQtyRecovery && allowPull) {
      console.log("[channels] recovering quantity from remote (INW sold out, channel in stock)", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        remoteQty: remote.quantity,
        inwQty: currentQty,
      });
      pulledQuantity = await applyRemoteQuantityToStoreItem(link.storeItemId, remote.quantity, {
        provider,
        memberId: connection.memberId,
      });
      if (pulledQuantity) {
        currentQty = remote.quantity;
      }
    }
    
    if (contentDecision === "pull" && allowPull) {
      if (provider === "ebay") {
        const legacyId =
          resolveEbayLegacyListingId(link.externalListingId) ??
          resolveEbayLegacyListingId(remote.externalListingId);
        if (!legacyId) {
          console.warn("[channels] eBay pull skipped: no legacy Item ID", {
            storeItemId: link.storeItemId,
            externalListingId: link.externalListingId,
          });
        } else {
          try {
            const result = await refreshEbayListingByItemId(ctx.accessToken, legacyId);
            if (result?.updated) {
              pulledContent = result.changes.some(
                (c) => !c.startsWith("quantity") && c !== "ended → sold_out"
              );
              pulledQuantity = result.changes.some(
                (c) => c.startsWith("quantity") || c.includes("sold_out")
              );
              if (pulledQuantity) currentQty = remote.quantity;
              console.log("[channels] eBay GetItem pull applied", {
                storeItemId: link.storeItemId,
                legacyId,
                changes: result.changes,
              });
            } else {
              console.log("[channels] eBay GetItem found no field changes", {
                storeItemId: link.storeItemId,
                legacyId,
              });
            }
          } catch (e) {
            console.error("[channels] eBay GetItem refresh failed", {
              storeItemId: link.storeItemId,
              legacyId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else {
        console.log("[channels] pulling content from remote", {
          storeItemId: link.storeItemId,
          remoteTitle: remote.title,
          remotePriceCents: remote.priceCents,
          remoteDescription: remote.description?.slice(0, 50),
          remotePhotos: remote.photos?.length,
        });
        pulledContent = await applyRemoteContentToStoreItem(link.storeItemId, remote);
        console.log("[channels] pull result", { storeItemId: link.storeItemId, pulledContent });

        if (remoteQtyKnown && remote.quantity !== item.quantity) {
          console.log("[channels] pulling quantity from remote", {
            storeItemId: link.storeItemId,
            oldQty: item.quantity,
            newQty: remote.quantity,
          });
          pulledQuantity = await applyRemoteQuantityToStoreItem(link.storeItemId, remote.quantity, {
            provider,
            memberId: connection.memberId,
          });
        }
      }
    } else if (contentDecision === "pull" && !allowPull) {
      console.log("[channels] skipping pull due to sync direction setting", {
        storeItemId: link.storeItemId,
        syncDirection,
      });
    }

    // Determine quantity sync direction when quantities differ but content didn't trigger a pull
    let attemptedPush = false;
    let pushOk = false;
    
    if (contentDecision === "push" && allowPush && !needsQtyRecovery) {
      attemptedPush = true;
      pushOk = channelSyncSucceeded(
        await updateStoreItemOnChannels(link.storeItemId),
        provider
      );
    } else if (contentDecision === "push" && needsQtyRecovery) {
      console.log("[channels] skipping push after qty recovery (avoid pushing stale zero inventory)", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
      });
    } else if (contentDecision === "push" && !allowPush) {
      console.log("[channels] skipping push due to sync direction setting", {
        storeItemId: link.storeItemId,
        syncDirection,
      });
    } else if (qtyDiffers && contentDecision !== "pull") {
      // Quantity differs but we didn't pull content - need to decide direction
      // If remote quantity changed (remote != baseline), pull from remote
      // If INW quantity changed (inw != baseline), push to remote
      const remoteQtyChanged = remoteQtyKnown && 
        link.syncBaselineQty != null && 
        remote.quantity !== link.syncBaselineQty;
      
      if (remoteQtyChanged && !inwQtyChangedSinceBaseline && allowPull) {
        // Remote changed, INW didn't - pull from remote
        console.log("[channels] pulling quantity from remote (qty-only change)", {
          storeItemId: link.storeItemId,
          oldQty: item.quantity,
          newQty: remote.quantity,
          baselineQty: link.syncBaselineQty,
        });
        pulledQuantity = await applyRemoteQuantityToStoreItem(link.storeItemId, remote.quantity, {
          provider,
          memberId: connection.memberId,
        });
      } else if (allowPush && !(remoteQtyKnown && remote.quantity > 0 && currentQty === 0)) {
        // INW changed or both changed - push to channels (never push zero when channel has stock)
        attemptedPush = true;
        pushOk = channelSyncSucceeded(
          await syncInventoryToChannels(link.storeItemId),
          provider
        );
      }
    }

    // If we pulled content, push to other channels (not the one we pulled from)
    if (pulledContent && contentDecision !== "push") {
      await updateStoreItemOnChannels(link.storeItemId, { skipProviders: [provider] });
    }
    
    // If we pulled quantity, also push to other channels
    if (pulledQuantity) {
      await syncInventoryToChannels(link.storeItemId, { skipProviders: [provider] });
    }

    // Update lastInboundAt if we pulled anything
    if (pulledContent || pulledQuantity) {
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

    // Write new baseline after successful sync
    if (pulledContent || pulledQuantity || (attemptedPush && pushOk)) {
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
