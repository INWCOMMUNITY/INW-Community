import { prisma } from "database";
import { getConnectionContext, withConnectionAuthRetry } from "./connection";
import {
  applyRemoteContentToStoreItem,
  applyRemoteStockFromChannel,
  inboundDescriptionsMatch,
  remoteContentDiffersFromStoreItem,
  remoteTitleOrPriceDiffersFromStoreItem,
  shouldApplyAggregateRemoteQuantity,
} from "./apply-remote-listing";
import { getAdapter } from "./registry";
import { updateStoreItemOnChannels } from "./outbound";
import { channelSyncSucceeded, syncInventoryToChannels } from "./sync-inventory";
import {
  inwChangedSinceBaseline,
  newerChannelEditShouldPull,
  resolveSyncDirection,
  syncContentHash,
  syncMetaHash,
  SYNC_ECHO_SKEW_MS,
  type SyncDirection,
} from "./sync-baseline";
import { clampSaneInventoryQty } from "./inventory-sanity";
import { variantsFingerprint } from "./variant-sync";
import { isMadeToOrderTracking, MTO_CHANNEL_QUANTITY } from "@/lib/listing-variant-matrix";
import { type ChannelProvider, type RemoteListingSummary } from "./types";
import { getChannelCapabilities } from "./capabilities";
import { indexEbayRemoteListings, resolveEbayLegacyListingId } from "./ebay/mapping";
import { refreshEbayListingByItemId } from "./ebay/pull-ebay-updates";
import { fetchEbayItemDetails } from "./ebay/trading";
import { logSyncEvent } from "./sync-log";
import { shouldBlockSoldOutQtyRecovery } from "./sold-out-guard";
import {
  persistRemoteCatalogState,
  persistRemoteDeletedPending,
  clearRemoteCatalogStateIfSet,
  clearRemoteDeletedNoticeIfSet,
  isRemoteDeletedPending,
} from "./listing-link-flags";
import {
  isInboundCatalogContentEcho,
  isOwnChannelPushEcho,
  remoteCatalogChangedSinceBaseline,
  remoteListingDisagreesForSync,
  newerChannelQtyEditShouldPull,
  shouldHoldQtyPushForUntrustedRemote,
  shouldFlagWixRemoteDeleted,
  shouldLogCatalogConflict,
} from "./inbound-catalog-decision";
import { wixProductIsGone } from "./wix/listing-exists";
import {
  etsyLinkedListingNeedsHydrate,
  etsyCatalogShouldNoopUnhydrated,
  fetchEtsyListingForInbound,
  ETSY_CRON_HYDRATE_LIMIT,
  etsyInboundHydratePriority,
  etsyHydrateBelongsInActiveCatalog,
  etsyRemoteQuantityIsKnown,
  shouldSkipEtsyUntrustedZeroPush,
} from "./etsy/listing-exists";
import { enrichEtsyListingSummaryWithInventory } from "./etsy/variants";
import {
  inboundListingPhotosDiffer,
  inwHostedPhotosChangedSinceLastPush,
  marketplaceCdnPhotoRehostOnly,
  readStoredPhotoUrls,
} from "./photo-urls";
import {
  tryAcquireCronLock,
  releaseCronLock,
  renewCronLock,
  shouldRenewCronLock,
  INBOUND_CATALOG_LOCK_TTL_MS,
} from "@/lib/cron-job-lock";

/**
 * Max per-product "is it really gone?" probes to run in one tick when a Wix catalog read comes
 * back empty. Bounds the cron budget; any remainder is deferred to the next tick.
 */
const WIX_EMPTY_CATALOG_VERIFY_CAP = 25;

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
  lastPushedAt: Date | null;
  lastPushedPhotos: unknown;
  conflictDetails: unknown;
  storeItem: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
    quantity: number;
    status: string;
    updatedAt: Date;
    inventoryTracking: string;
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
      safetyBuffer: true,
    },
  });
  
  // Check if sync is globally disabled
  if (memberPrefs && !memberPrefs.syncEnabled) {
    console.log("[channels] sync globally disabled for member", { memberId: connection.memberId });
    return { updated: 0, removed: 0 };
  }
  
  // Get conflict resolution preference (default: most_recent)
  const conflictResolution = (memberPrefs?.conflictResolution ?? "most_recent") as "most_recent" | "inw_wins" | "manual_review";
  const globalSafetyBuffer = memberPrefs?.safetyBuffer ?? 0;
  
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

  const lock = await tryAcquireCronLock(
    `inbound-catalog:${connection.id}`,
    INBOUND_CATALOG_LOCK_TTL_MS
  );
  if (!lock.acquired) {
    console.log("[channels] inbound catalog skipped; already running", {
      connectionId: connection.id,
      provider,
    });
    return { updated: 0, removed: 0 };
  }

  try {
  const links = (await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider, syncEnabled: true },
    select: {
      id: true,
      storeItemId: true,
      externalListingId: true,
      syncBaselineHash: true,
      syncBaselineQty: true,
      syncBaselineAt: true,
      lastPushedAt: true,
      lastPushedPhotos: true,
      conflictDetails: true,
      storeItem: {
        select: {
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          status: true,
          updatedAt: true,
          inventoryTracking: true,
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
      withRemoteUpdatedAt: remoteList.filter((l) => l.remoteUpdatedAt != null).length,
      sample: remoteList.slice(0, 2).map(l => ({ id: l.externalListingId, title: l.title?.slice(0, 30) })),
    });
  } catch (e) {
    console.error("[channels] inbound catalog list failed", { provider, error: String(e) });
    return { updated: 0, removed: 0 };
  }

  // Empty catalog usually means wrong API version or a transient failure — do not mark all links removed.
  // Wix list returning [] after successful v1/v3 queries means the shop has no visible products.
  if (remoteList.length === 0) {
    if (provider === "wix") {
      // An empty Wix read is usually a transient glitch or the wrong catalog version — NOT
      // proof every listing was deleted. Never mass-flag: confirm each product is really gone
      // with a per-product probe, and cap probes per tick so a large shop can't blow the budget.
      let removed = 0;
      let probed = 0;
      let deferred = 0;
      for (const link of links) {
        if (isRemoteDeletedPending(link.conflictDetails)) continue;
        if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") continue;
        if (probed >= WIX_EMPTY_CATALOG_VERIFY_CAP) {
          deferred += 1;
          continue;
        }
        probed += 1;
        const confirmedGone = await wixProductIsGone(ctx, link.externalListingId).catch(() => false);
        if (
          !shouldFlagWixRemoteDeleted({
            confirmedGone,
            alreadyPending: false,
            storeItemStatus: link.storeItem.status,
          })
        ) {
          continue;
        }
        const flagged = await persistRemoteDeletedPending({
          linkId: link.id,
          conflictDetails: link.conflictDetails,
          provider,
        });
        if (flagged) removed += 1;
      }
      console.warn("[channels] inbound catalog empty for Wix — flagged only per-product confirmed deletes", {
        connectionId: connection.id,
        links: links.length,
        probed,
        removed,
        deferred,
      });
      return { updated: 0, removed };
    }
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

  const etsyGoneIds = new Set<string>();
  const etsyInventoryEnriched = new Set<string>();
  const etsyNeedsHydrateIds = new Set<string>();
  const etsyHydratedThisTick = new Set<string>();
  if (provider === "etsy") {
    let hydrated = 0;
    let hydratedMissingFromList = 0;
    const hydrateLinks = links
      .filter((link) =>
        etsyLinkedListingNeedsHydrate(remoteById.get(link.externalListingId), {
          title: link.storeItem.title,
          quantity: link.storeItem.quantity,
          updatedAt: link.storeItem.updatedAt,
          baselineAt: link.syncBaselineAt,
        })
      )
      .sort(
        (a, b) =>
          etsyInboundHydratePriority(
            remoteById.get(a.externalListingId),
            a.storeItem.quantity,
            { baselineAt: a.syncBaselineAt }
          ) -
          etsyInboundHydratePriority(
            remoteById.get(b.externalListingId),
            b.storeItem.quantity,
            { baselineAt: b.syncBaselineAt }
          )
      );
    for (const link of hydrateLinks) etsyNeedsHydrateIds.add(link.externalListingId);
    const hydrateThisTick = hydrateLinks.slice(0, ETSY_CRON_HYDRATE_LIMIT);
    if (hydrateLinks.length > hydrateThisTick.length) {
      console.warn("[channels] etsy inbound hydrate cap hit; leftover wait for next tick", {
        connectionId: connection.id,
        dirty: hydrateLinks.length,
        capped: hydrateThisTick.length,
      });
    }
    for (const link of hydrateThisTick) {
      const existing = remoteById.get(link.externalListingId);
      try {
        const fetched = await fetchEtsyListingForInbound(ctx.accessToken, link.externalListingId);
        if (fetched.status === "gone") {
          etsyGoneIds.add(link.externalListingId);
          continue;
        }
        if (!etsyHydrateBelongsInActiveCatalog(fetched.state)) {
          console.log("[channels] etsy inbound hydrate skipped; listing is not active", {
            storeItemId: link.storeItemId,
            externalListingId: link.externalListingId,
            state: fetched.state,
          });
          continue;
        }
        const inventoryLoaded = await enrichEtsyListingSummaryWithInventory(
          ctx.accessToken,
          fetched.summary,
          connection.externalShopId
        );
        if (inventoryLoaded) {
          etsyInventoryEnriched.add(link.externalListingId);
          etsyInventoryEnriched.add(fetched.summary.externalListingId);
        }
        remoteById.set(link.externalListingId, fetched.summary);
        remoteById.set(fetched.summary.externalListingId, fetched.summary);
        etsyHydratedThisTick.add(link.externalListingId);
        etsyHydratedThisTick.add(fetched.summary.externalListingId);
        hydrated += 1;
        if (!existing) hydratedMissingFromList += 1;
        console.log("[channels] etsy inbound hydrate", {
          storeItemId: link.storeItemId,
          externalListingId: link.externalListingId,
          state: fetched.state,
          wasMissingFromActiveList: !existing,
          remoteUpdatedAt: fetched.summary.remoteUpdatedAt?.toISOString() ?? null,
          title: fetched.summary.title.slice(0, 40),
          quantity: fetched.summary.quantity,
          inventoryLoaded,
        });
      } catch (e) {
        console.warn("[channels] etsy inbound hydrate failed", {
          storeItemId: link.storeItemId,
          externalListingId: link.externalListingId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    console.log("[channels] etsy inbound hydrate summary", {
      connectionId: connection.id,
      linked: links.length,
      activeList: remoteList.length,
      hydrated,
      hydratedMissingFromList,
      gone: etsyGoneIds.size,
    });
  }

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
          remoteShippingProfileId:
            details.remoteShippingProfileId ?? existing?.remoteShippingProfileId ?? null,
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

  const freshBaselineRows = await prisma.channelListingLink.findMany({
    where: { id: { in: links.map((l) => l.id) } },
    select: {
      id: true,
      syncBaselineHash: true,
      syncBaselineQty: true,
      syncBaselineAt: true,
      lastPushedAt: true,
      lastPushedPhotos: true,
    },
  });
  const freshById = new Map(freshBaselineRows.map((row) => [row.id, row]));
  for (const link of links) {
    const fresh = freshById.get(link.id);
    if (!fresh) continue;
    link.syncBaselineHash = fresh.syncBaselineHash;
    link.syncBaselineQty = fresh.syncBaselineQty;
    link.syncBaselineAt = fresh.syncBaselineAt;
    link.lastPushedAt = fresh.lastPushedAt;
    link.lastPushedPhotos = fresh.lastPushedPhotos;
  }

  let updated = 0;
  let removed = 0;

  let processedInLoop = 0;
  for (const link of links) {
    // Keep our exclusive lease alive on large shops so the next tick can't steal it and overlap
    // media writes mid-run.
    if (shouldRenewCronLock(processedInLoop)) {
      await renewCronLock(
        `inbound-catalog:${connection.id}`,
        lock.holderId,
        INBOUND_CATALOG_LOCK_TTL_MS
      );
    }
    processedInLoop++;
    const remote = remoteById.get(link.externalListingId);

    // Product no longer visible on the channel -> sell out on INW + push 0 to others.
    // eBay ActiveList can omit a live item while GetItem still succeeds — do not sell out.
    if (!remote) {
      if (provider === "ebay") {
        const changed = await persistRemoteCatalogState({
          linkId: link.id,
          conflictDetails: link.conflictDetails,
          state: "inactive_outside_catalog",
        });
        if (changed) {
          console.warn("[channels] eBay link missing from seller list after GetItem hydrate; skip sell-out", {
            storeItemId: link.storeItemId,
            externalListingId: link.externalListingId,
          });
        }
        continue;
      }
      if (provider === "etsy") {
        if (!etsyGoneIds.has(link.externalListingId)) {
          console.warn("[channels] skip sell-out; Etsy listing hydrate inconclusive", {
            storeItemId: link.storeItemId,
            externalListingId: link.externalListingId,
          });
          continue;
        }
      }
      if (provider === "wix") {
        // Absence from the catalog list can mean a truncated page cap, not a delete.
        // Only flag when a per-product probe confirms the product is really gone.
        const confirmedGone = await wixProductIsGone(ctx, link.externalListingId).catch(() => false);
        if (!confirmedGone) {
          console.warn("[channels] skip Wix sell-out; product not confirmed gone (catalog may be truncated)", {
            storeItemId: link.storeItemId,
            externalListingId: link.externalListingId,
          });
          continue;
        }
      }
      if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") {
        continue;
      }
      const flagged = await persistRemoteDeletedPending({
        linkId: link.id,
        conflictDetails: link.conflictDetails,
        provider,
      });
      if (flagged) {
        console.warn("[channels] remote listing deleted; waiting for seller decision", {
          storeItemId: link.storeItemId,
          provider,
          externalListingId: link.externalListingId,
        });
        removed += 1;
      }
      continue;
    }

    if (isRemoteDeletedPending(link.conflictDetails) && provider === "wix") {
      const stillGone = await wixProductIsGone(ctx, link.externalListingId).catch(() => true);
      if (stillGone) continue;
    }

    await clearRemoteCatalogStateIfSet(link.id, link.conflictDetails);
    await clearRemoteDeletedNoticeIfSet(link.id, link.conflictDetails);

    if (
      provider === "etsy" &&
      etsyCatalogShouldNoopUnhydrated({
        needsHydrate: etsyNeedsHydrateIds.has(link.externalListingId),
        hydratedThisTick: etsyHydratedThisTick.has(link.externalListingId),
      })
    ) {
      console.warn("[channels] skip Etsy catalog apply; hydrate needed but this tick did not GET it", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
      });
      continue;
    }

    const item = link.storeItem;
    const remoteQtyKnown =
      provider === "etsy"
        ? etsyRemoteQuantityIsKnown({
            quantity: remote.quantity,
            quantityKnown: remote.quantityKnown,
            inventoryEnriched:
              etsyInventoryEnriched.has(link.externalListingId) ||
              etsyInventoryEnriched.has(remote.externalListingId),
          })
        : remote.quantityKnown !== false;

    const inwHash = syncContentHash(item);
    const baseHash = link.syncBaselineHash ?? inwHash;
    const baseAt = link.syncBaselineAt ?? remote.remoteUpdatedAt ?? new Date();
    const inwContentChanged = inwChangedSinceBaseline({
      hashDiffers: inwHash !== baseHash,
      inwUpdatedAt: item.updatedAt,
      baselineAt: baseAt,
    });
    const remoteHash = remoteListingContentHash(remote);

    const titleOrPriceDiffers = remoteTitleOrPriceDiffersFromStoreItem(item, remote);
    const descriptionDiffers = !inboundDescriptionsMatch(item.description, remote.description);
    const remoteDescriptionPresent = Boolean(remote.description?.trim());
    const cdnPhotoRehostOnly = marketplaceCdnPhotoRehostOnly(item.photos, remote.photos ?? []);
    const photosDiffer = inboundListingPhotosDiffer(item.photos, remote.photos ?? []);
    const remoteContentActuallyDiffers = remoteContentDiffersFromStoreItem(item, remote);
    const remoteDisagreesWithInw = remoteListingDisagreesForSync({
      titleOrPriceDiffers,
      descriptionDiffers,
      remoteDescriptionPresent,
      photosDiffer,
      marketplaceCdnPhotoRehostOnly: cdnPhotoRehostOnly,
    });
    const ownPushEcho = isOwnChannelPushEcho({
      lastPushedAt: link.lastPushedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
      inwUpdatedAt: item.updatedAt,
      listingsDisagree:
        titleOrPriceDiffers ||
        (remoteQtyKnown && remote.quantity !== item.quantity),
    });

    const remoteTimestampNewer =
      remote.remoteUpdatedAt != null && remote.remoteUpdatedAt.getTime() > baseAt.getTime();
    const remoteContentChanged = remoteCatalogChangedSinceBaseline({
      remoteTimestampNewer,
      remoteHashDiffersFromBaseline: remoteHash !== baseHash,
      remoteDisagreesWithInw,
      titleOrPriceDiffers,
      descriptionDiffers,
      inwContentChanged,
      isOwnPushEcho: ownPushEcho,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });

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

    // Compute the BUFFER-ADJUSTED qty that syncInventoryToChannels would actually
    // push to this channel.  The remote listing stores this adjusted value, so the
    // drift comparison must use it — otherwise a safety buffer causes
    // remote.quantity !== item.quantity every tick and drives a perpetual re-push
    // storm (the Shopify-driven snap-back bug).
    const channelInventoryOffset = (connConfig.inventoryOffset as number) ?? 0;
    const expectedRemoteQty = isMadeToOrderTracking(item.inventoryTracking)
      ? MTO_CHANNEL_QUANTITY
      : Math.max(0, item.quantity - globalSafetyBuffer - channelInventoryOffset);
    const qtyDiffers =
      (remoteQtyKnown && remote.quantity !== expectedRemoteQty) || inwQtyChangedSinceBaseline;

    const hashEcho = isInboundCatalogContentEcho({
      inwContentChanged,
      remoteContentChanged,
      qtyDiffers,
      titleOrPriceDiffers,
      descriptionDiffers,
      remoteContentActuallyDiffers,
      marketplaceCdnPhotoRehostOnly: cdnPhotoRehostOnly,
      inwHostedPhotosChangedSinceLastPush: inwHostedPhotosChangedSinceLastPush(
        item.photos,
        readStoredPhotoUrls(link.lastPushedPhotos)
      ),
    });
    if (hashEcho) {
      contentDecision = "noop";
    }

    // Shop-list qty 0 is often a variation listing with live offering stock.
    // Do not PATCH Etsy to INW zero until inventory GET has confirmed it.
    if (
      provider === "etsy" &&
      contentDecision === "push" &&
      shouldSkipEtsyUntrustedZeroPush({
        inwQuantity: item.quantity,
        remoteQtyKnown,
      })
    ) {
      console.log("[channels] skip Etsy zero push; shop-list quantity is untrusted", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        listQty: remote.quantity,
      });
      contentDecision = "noop";
    }

    // Stale INW baseline + inw_wins would push the hub copy over a newer Etsy/Wix
    // save and never fan that edit out to the other linked stores.
    // Gate on remoteContentChanged: only pull when the remote genuinely moved off the
    // agreed baseline (a real seller edit). A stale/lagged remote that merely disagrees
    // with a fresh INW edit must NOT revert that edit (RC-F Etsy bounce-back).
    if (
      contentDecision === "push" &&
      !ownPushEcho &&
      remoteContentChanged &&
      newerChannelEditShouldPull({
        remoteContentDiffers: remoteDisagreesWithInw,
        inwUpdatedAt: item.updatedAt,
        remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
        baselineAt: baseAt,
      })
    ) {
      console.log("[channels] pulling newer channel edit instead of inw_wins push", {
        storeItemId: link.storeItemId,
        provider,
        remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString(),
        inwUpdatedAt: item.updatedAt.toISOString(),
      });
      contentDecision = "pull";
    }

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
        remoteDisagreesWithInw,
        remoteContentChanged,
        ownPushEcho,
        staleRemoteNeedsPush,
        hashEcho,
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
      if (inwContentChanged && !remoteDisagreesWithInw) {
        // Even when INW already matches THIS channel, a Shopify (or any) edit must still reach
        // the OTHER shops — the save-time push can be partial. Fan out to non-provider siblings
        // with the source timestamp (idempotent absolute values make a double-push safe).
        console.log("[channels] INW edit already on channel — fanning out to other shops", {
          storeItemId: link.storeItemId,
          provider,
        });
        await updateStoreItemOnChannels(link.storeItemId, {
          skipProviders: [provider],
          // Fan out with the SOURCE timestamp, not the post-apply now(), so siblings that
          // already have a newer copy are not reverted.
          sourceUpdatedAt: remote.remoteUpdatedAt ?? undefined,
        });
        await writeBaseline(link.id, link.storeItemId, remote, true);
        continue;
      }
      if (
        hashEcho ||
        staleRemoteNeedsPush ||
        ownPushEcho ||
        inwHash !== baseHash ||
        link.syncBaselineHash == null ||
        link.syncBaselineAt == null
      ) {
        if (hashEcho) {
          console.log("[channels] inbound catalog hash echo — rewriting baseline", {
            storeItemId: link.storeItemId,
            provider,
            externalListingId: link.externalListingId,
          });
        }
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

    if (shouldLogCatalogConflict({
      inwContentChanged,
      remoteContentChanged,
      remoteDisagreesWithInw,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    })) {
      if (contentDecision === "noop" && conflictResolution === "manual_review") {
        // Conflict queued for manual review - log but don't auto-resolve
        logSyncEvent(
          connection.memberId,
          provider,
          "conflict_pending",
          `Conflict detected: both INW and ${provider} changed. Queued for manual review. Remote updated ${remote.remoteUpdatedAt?.toISOString() ?? "unknown"}, INW updated ${item.updatedAt.toISOString()}.`,
          link.storeItemId
        );
        // Mark the link pending so it surfaces in Needs Attention / sync health for the seller.
        await prisma.channelListingLink
          .update({
            where: { id: link.id },
            data: {
              conflictResolution: "pending",
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
          })
          .catch((e) =>
            console.warn("[channels] failed to mark conflict pending", {
              linkId: link.id,
              provider,
              error: String(e),
            })
          );
      } else {
        const winner = contentDecision === "pull" ? "remote" : "INW";
        logSyncEvent(
          connection.memberId,
          provider,
          "conflict_resolved",
          `Kept ${winner} version (${conflictResolution}). Remote updated ${remote.remoteUpdatedAt?.toISOString() ?? "unknown"}, INW updated ${item.updatedAt.toISOString()}.`,
          link.storeItemId
        );
        // Auto-resolved: clear any prior manual-review flag so it leaves Needs Attention.
        await prisma.channelListingLink
          .updateMany({
            where: { id: link.id, conflictResolution: "pending" },
            data: { conflictResolution: null },
          })
          .catch((e) =>
            console.warn("[channels] failed to clear resolved conflict flag", {
              linkId: link.id,
              provider,
              error: String(e),
            })
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
    // Prefer pulling quantity over pushing zero — unless a sale or failed zero-push
    // is in play, in which case retry the zero write instead of resurrecting stock.
    const staleZeroVsRemoteStock =
      qtyDiffers && remoteQtyKnown && remote.quantity > 0 && currentQty === 0;
    const blockRecovery =
      staleZeroVsRemoteStock && (await shouldBlockSoldOutQtyRecovery(link.storeItemId));
    let canApplyAggregateQty = true;
    if (staleZeroVsRemoteStock && !blockRecovery) {
      const variantRow = await prisma.storeItem.findUnique({
        where: { id: link.storeItemId },
        select: { variants: true },
      });
      canApplyAggregateQty = shouldApplyAggregateRemoteQuantity(variantRow?.variants);
    }
    const needsQtyRecovery =
      staleZeroVsRemoteStock &&
      !blockRecovery &&
      (canApplyAggregateQty || (provider === "etsy" && Boolean(remote.variantsKnown)));

    if (blockRecovery) {
      console.log("[channels] skipping qty recovery after sale or failed zero push", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        remoteQty: remote.quantity,
        inwQty: currentQty,
      });
    }

    if (needsQtyRecovery && allowPull) {
      console.log("[channels] recovering quantity from remote (INW sold out, channel in stock)", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        remoteQty: remote.quantity,
        inwQty: currentQty,
      });
      pulledQuantity = await applyRemoteStockFromChannel(link.storeItemId, remote, {
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
          pulledQuantity = await applyRemoteStockFromChannel(link.storeItemId, remote, {
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
      // INW won the comparison here (INW is authoritative), so the hub's own updatedAt is the
      // correct source time — do NOT override with the older remote timestamp or the outbound
      // guard would suppress this legitimate push to the siblings.
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
      const skipEtsyUntrustedZero =
        provider === "etsy" &&
        shouldSkipEtsyUntrustedZeroPush({
          inwQuantity: item.quantity,
          remoteQtyKnown,
        });
      // Quantity differs but we didn't pull content — decide direction by RECENCY, not by
      // "who drifted from baseline". A sale on another channel drifts INW's baseline qty
      // without being a newer INW edit, so the old baseline-only rule pushed INW's stale
      // quantity back over a real channel edit (the reported snap-back). Most-recent edit wins.
      // Pass the ADJUSTED qty so the function compares what the channel SHOULD
      // hold against what it does hold.  With a safety buffer the raw hub qty
      // always differs from the remote — that's by design, not a channel edit.
      const remoteQtyChanged = newerChannelQtyEditShouldPull({
        remoteQtyKnown,
        remoteQuantity: remote.quantity,
        inwQuantity: expectedRemoteQty,
        inwQtyChangedSinceBaseline,
        inwUpdatedAt: item.updatedAt,
        remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
        baselineAt: link.syncBaselineAt ?? null,
      });
      // Never push INW's quantity to a channel whose true stock we could not read this tick
      // and that may have been edited at/after our baseline — that would revert a real sale.
      const holdUntrustedRemote = shouldHoldQtyPushForUntrustedRemote({
        provider,
        remoteQtyKnown,
        remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
        inwUpdatedAt: item.updatedAt,
      });

      console.log("[channels] qty-only sync decision", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        provider,
        direction: remoteQtyChanged ? "pull" : holdUntrustedRemote ? "hold" : "push",
        inwQty: item.quantity,
        remoteQty: remoteQtyKnown ? remote.quantity : null,
        remoteQtyKnown,
        baselineQty: link.syncBaselineQty,
        inwQtyChangedSinceBaseline,
        inwUpdatedAt: item.updatedAt?.toISOString() ?? null,
        remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString() ?? null,
        baselineAt: link.syncBaselineAt?.toISOString() ?? null,
      });

      if (
        remoteQtyChanged &&
        allowPull &&
        !blockRecovery &&
        (canApplyAggregateQty || (provider === "etsy" && Boolean(remote.variantsKnown)))
      ) {
        // Remote is the most-recent edit - pull from remote
        console.log("[channels] pulling quantity from remote (qty-only change)", {
          storeItemId: link.storeItemId,
          oldQty: item.quantity,
          newQty: remote.quantity,
          baselineQty: link.syncBaselineQty,
        });
        pulledQuantity = await applyRemoteStockFromChannel(link.storeItemId, remote, {
          provider,
          memberId: connection.memberId,
        });
      } else if (skipEtsyUntrustedZero) {
        console.log("[channels] skip Etsy qty-only zero push; shop-list quantity is untrusted", {
          storeItemId: link.storeItemId,
          externalListingId: link.externalListingId,
        });
      } else if (holdUntrustedRemote) {
        console.log("[channels] hold qty push; remote quantity untrusted and not proven stale", {
          storeItemId: link.storeItemId,
          externalListingId: link.externalListingId,
          remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString() ?? null,
        });
      } else if (allowPush && !needsQtyRecovery) {
        // INW changed or both changed — push, including zero when recovery is blocked.
        attemptedPush = true;
        pushOk = channelSyncSucceeded(
          await syncInventoryToChannels(link.storeItemId),
          provider
        );
      }
    }

    // If we pulled content, push to other channels (not the one we pulled from)
    if (pulledContent && contentDecision !== "push") {
      await updateStoreItemOnChannels(link.storeItemId, {
        skipProviders: [provider],
        sourceUpdatedAt: remote.remoteUpdatedAt ?? undefined,
      });
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
  } finally {
    await releaseCronLock(`inbound-catalog:${connection.id}`, lock.holderId);
  }
}
