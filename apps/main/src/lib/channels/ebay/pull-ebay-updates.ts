import { prisma, Prisma } from "database";
import { withConnectionAuthRetry, isChannelAuthError, refreshConnectionToken } from "../connection";
import {
  ebayGetItemMarksInwSoldOut,
  ebayGetItemQtyIsUnsoldZero,
  fetchEbayItemDetails,
} from "./trading";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { ebayAspectsFingerprint } from "./ebay-compat";
import { fetchAndCacheEbayInventoryAspects } from "./inventory-aspects-cache";
import { normalizeEbayPhotoUrl, shouldApplyEbayInboundPhotos } from "./photos";
import { selectInboundListingPhotos } from "../photo-urls";
import { storeListingDescription } from "../import-listing";
import { resolveInwCategoryFromEbayPath } from "../category-resolver";
import { isValidPresetSubcategory } from "../repair-categories";
import { syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "../sync-baseline";
import { variantsFingerprint } from "../variant-sync";
import { applyRemoteListingRemoved } from "../apply-remote-listing";
import { syncInventoryToChannels } from "../sync-inventory";
import { updateStoreItemOnChannels } from "../outbound";
import {
  inboundContentFanoutKind,
  persistEbayListingActive,
  persistEbayListingEnded,
} from "../listing-link-flags";
import { attachShippingOptionOnImport } from "@/lib/shipping-options";

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

export type PullResult = {
  storeItemId: string;
  title: string;
  updated: boolean;
  changes: string[];
  ended?: boolean;
};

function photosEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

/**
 * GetItem with no LastModified used to apply after this window and that
 * rewrote good cron pulls (TEST 2 ping-pong). Kept only for tests/callers
 * that still import it; apply now requires a newer LastModified or two
 * matching snapshots after our own push echo has expired.
 */
export const EBAY_INBOUND_ECHO_MS = 15 * 60 * 1000;

/** How many GetItem calls one cron pass makes before rotating to the next listings. */
export const EBAY_CRON_GETITEM_LIMIT = 40;

/** Metadata-only GetItem writes must not start the echo window. */
const EBAY_INBOUND_META_KEYS = new Set(["ebayCategoryId", "category", "subcategory"]);

export function isEbayInboundContentChange(updateData: Record<string, unknown>): boolean {
  return Object.keys(updateData).some((key) => !EBAY_INBOUND_META_KEYS.has(key));
}

/** Failed GetItem (expired token, empty envelope) must not skip, apply, or stamp lastInboundAt. */
export function ebayGetItemDetailsAreUsable(details: {
  title: string | null;
  priceCents: number | null;
  quantity: number | null;
}): boolean {
  return details.title != null || details.priceCents != null || details.quantity != null;
}

export function ebayGetItemIsStaleVersusInw(args: {
  lastInboundAt: Date | null;
  lastPushedAt?: Date | null;
  lastAppliedRemoteAt?: Date | null;
  inwUpdatedAt: Date | null;
  ebayLastModified?: Date | null;
  now?: Date;
}): boolean {
  const inboundAt = args.lastInboundAt?.getTime();
  const pushedAt = args.lastPushedAt?.getTime();
  const appliedRemoteAt = args.lastAppliedRemoteAt?.getTime();
  const inwAt = args.inwUpdatedAt?.getTime();
  const modifiedAt = args.ebayLastModified?.getTime();
  // First eBay pull for this link.
  if (inboundAt == null && pushedAt == null) return false;
  // After a successful pull or push, a replica with no LastModified is old news.
  if (modifiedAt == null) return true;
  // Our own content write echoes back with LastModified ≈ lastPushedAt.
  // Do not use lastPushedAt as a floor — inventory qty pushes would then
  // hide real eBay revises that happened earlier in the same cron window.
  if (
    pushedAt != null &&
    modifiedAt >= pushedAt - 5_000 &&
    modifiedAt <= pushedAt + 2_000
  ) {
    return true;
  }
  const floor = Math.max(inboundAt ?? 0, inwAt ?? 0, appliedRemoteAt ?? 0);
  return modifiedAt <= floor + 2000;
}

export function ebayRemoteSnapshotHash(args: {
  title: string | null;
  priceCents: number | null;
  quantity: number | null;
}): string {
  return `${args.title ?? ""}|${args.priceCents ?? ""}|${args.quantity ?? ""}`;
}

export type EbayPendingInbound = { hash: string; seenAt: string };

export function readEbayPendingInboundHash(conflictDetails: unknown): string | null {
  if (!conflictDetails || typeof conflictDetails !== "object" || Array.isArray(conflictDetails)) {
    return null;
  }
  const pending = (conflictDetails as { ebayPendingInbound?: { hash?: unknown } }).ebayPendingInbound;
  return typeof pending?.hash === "string" && pending.hash ? pending.hash : null;
}

export function withEbayPendingInbound(
  conflictDetails: unknown,
  pending: EbayPendingInbound | null
): Prisma.InputJsonValue {
  const base =
    conflictDetails && typeof conflictDetails === "object" && !Array.isArray(conflictDetails)
      ? { ...(conflictDetails as Record<string, unknown>) }
      : {};
  if (pending) {
    base.ebayPendingInbound = pending;
  } else {
    delete base.ebayPendingInbound;
  }
  return base as Prisma.InputJsonValue;
}

export type EbayGetItemApplyDecision = {
  action: "apply" | "skip" | "pending";
  reason: string;
  pendingHash?: string;
};

/**
 * GetItem often omits LastModifiedTime (only StartTime/EndTime). Do not apply a
 * lagged replica after 15 minutes. Confirm a new snapshot on two consecutive crons
 * when LastModified is missing and INW has not been saved since the last inbound.
 */
export function ebayGetItemApplyDecision(args: {
  lastInboundAt: Date | null;
  lastPushedAt?: Date | null;
  lastAppliedRemoteAt?: Date | null;
  inwUpdatedAt: Date | null;
  ebayLastModified?: Date | null;
  inwTitle: string;
  inwPriceCents: number;
  inwQuantity: number;
  remoteTitle: string | null;
  remotePriceCents: number | null;
  remoteQuantity: number | null;
  pendingRemoteHash?: string | null;
  now?: Date;
}): EbayGetItemApplyDecision {
  const inboundAt = args.lastInboundAt?.getTime() ?? null;
  const pushedAt = args.lastPushedAt?.getTime() ?? null;
  const nowMs = args.now?.getTime() ?? Date.now();

  if (args.ebayLastModified != null) {
    return ebayGetItemIsStaleVersusInw(args)
      ? { action: "skip", reason: "lastModified-not-newer" }
      : { action: "apply", reason: "lastModified-newer" };
  }

  if (inboundAt == null && pushedAt == null) {
    return { action: "apply", reason: "first-pull" };
  }

  const remoteHash = ebayRemoteSnapshotHash({
    title: args.remoteTitle,
    priceCents: args.remotePriceCents,
    quantity: args.remoteQuantity,
  });
  const inwHash = ebayRemoteSnapshotHash({
    title: args.inwTitle,
    priceCents: args.inwPriceCents,
    quantity: args.inwQuantity,
  });
  if (remoteHash === inwHash) {
    return { action: "skip", reason: "matches-inw" };
  }

  // Right after we pushed, GetItem may still show the previous listing.
  if (pushedAt != null && nowMs - pushedAt < SYNC_ECHO_SKEW_MS) {
    return { action: "skip", reason: "echo-of-push" };
  }

  if (args.pendingRemoteHash === remoteHash) {
    return { action: "apply", reason: "confirmed-snapshot", pendingHash: remoteHash };
  }
  return { action: "pending", reason: "await-confirm", pendingHash: remoteHash };
}

/**
 * Pull latest data from eBay for a single listing by legacy item ID.
 * Used by webhook handler and manual refresh.
 */
export async function refreshEbayListingByItemId(
  accessToken: string,
  legacyItemId: string,
  opts?: {
    activeListingIds?: Set<string>;
    skipQuantity?: boolean;
    skipContent?: boolean;
    force?: boolean;
  }
): Promise<PullResult | null> {
  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider: "ebay",
      OR: [
        { externalListingId: legacyItemId },
        { externalListingId: `inw${legacyItemId}` },
      ],
    },
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
          secondaryCategory: true,
          shippingCostCents: true,
          aspects: true,
          variants: true,
          condition: true,
          ebayConditionEnum: true,
          ebayCategoryId: true,
          status: true,
          acceptOffers: true,
          minOfferCents: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!link || !link.storeItem) {
    console.log("[ebay] refreshEbayListingByItemId: no link found", { legacyItemId });
    return null;
  }

  const storeItem = link.storeItem;
  const details = await fetchEbayItemDetails(accessToken, legacyItemId);
  if (!ebayGetItemDetailsAreUsable(details)) {
    console.error("[ebay] refreshEbayListingByItemId: GetItem returned no listing fields", {
      storeItemId: storeItem.id,
      legacyItemId,
    });
    return {
      storeItemId: storeItem.id,
      title: storeItem.title,
      updated: false,
      changes: [],
    };
  }
  const applyDecision = ebayGetItemApplyDecision({
    lastInboundAt: link.lastInboundAt,
    lastPushedAt: link.lastPushedAt,
    lastAppliedRemoteAt: link.syncBaselineAt,
    inwUpdatedAt: storeItem.updatedAt,
    ebayLastModified: details.remoteUpdatedAt,
    inwTitle: storeItem.title,
    inwPriceCents: storeItem.priceCents,
    inwQuantity: storeItem.quantity,
    remoteTitle: details.title,
    remotePriceCents: details.priceCents,
    remoteQuantity: details.quantity,
    pendingRemoteHash: readEbayPendingInboundHash(link.conflictDetails),
  });

  const stillActive =
    opts?.activeListingIds != null
      ? opts.activeListingIds.has(legacyItemId)
      : !details.listingEnded;

  if (!stillActive || details.listingEnded) {
    if (!ebayGetItemMarksInwSoldOut(details)) {
      console.log("[ebay] refreshEbayListingByItemId: listing ended without a sale; keep INW listed", {
        storeItemId: storeItem.id,
        legacyItemId,
        listingEnded: details.listingEnded,
        quantitySold: details.quantitySold,
        quantity: details.quantity,
        forcedInactive: opts?.activeListingIds != null && !stillActive,
      });
      await persistEbayListingEnded(link.id, link.conflictDetails);
      return {
        storeItemId: storeItem.id,
        title: storeItem.title,
        updated: false,
        changes: [],
      };
    }
    await applyRemoteListingRemoved(storeItem.id);
    await persistEbayListingEnded(link.id, link.conflictDetails);
    await syncInventoryToChannels(storeItem.id, { skipProviders: ["ebay"] });
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        lastInboundAt: new Date(),
        syncStatus: "synced",
        syncBaselineQty: 0,
        syncBaselineAt: new Date(),
      },
    });
    return {
      storeItemId: storeItem.id,
      title: storeItem.title,
      updated: true,
      changes: ["ended → sold_out"],
      ended: true,
    };
  }

  let conflictDetails: unknown = await persistEbayListingActive(link.id, link.conflictDetails);

  await attachShippingOptionOnImport({
    memberId: storeItem.memberId,
    storeItemId: storeItem.id,
    source: "ebay",
    hint: { remoteProfileId: details.remoteShippingProfileId },
  }).catch((e) =>
    console.warn("[ebay] attach shipping option on GetItem pull failed", {
      storeItemId: storeItem.id,
      error: String(e),
    })
  );

  if (!opts?.force && applyDecision.action !== "apply") {
    if (applyDecision.action === "pending" && applyDecision.pendingHash) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          conflictDetails: withEbayPendingInbound(conflictDetails, {
            hash: applyDecision.pendingHash,
            seenAt: new Date().toISOString(),
          }),
        },
      });
    } else if (
      applyDecision.reason === "matches-inw" &&
      readEbayPendingInboundHash(conflictDetails)
    ) {
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { conflictDetails: withEbayPendingInbound(conflictDetails, null) },
        })
        .catch(() => {});
    }
    console.log("[ebay] refreshEbayListingByItemId: skip GetItem", {
      storeItemId: storeItem.id,
      legacyItemId,
      reason: applyDecision.reason,
      lastInboundAt: link.lastInboundAt?.toISOString() ?? null,
      lastPushedAt: link.lastPushedAt?.toISOString() ?? null,
      inwUpdatedAt: storeItem.updatedAt.toISOString(),
      ebayLastModified: details.remoteUpdatedAt?.toISOString() ?? null,
      getItemTitle: details.title,
      getItemPriceCents: details.priceCents,
      getItemQuantity: details.quantity,
    });
    return {
      storeItemId: storeItem.id,
      title: storeItem.title,
      updated: false,
      changes: [],
    };
  }

  const normalizedAspects = normalizeListingAspects(details.aspects);
  const remoteTitle = (details.title ?? storeItem.title).slice(0, 200);
  const aspectsForStorage = normalizedAspects;
  const photos = details.photos
    .map((u) => normalizeEbayPhotoUrl(u))
    .filter((u): u is string => Boolean(u));
  const description = storeListingDescription(details.description) ?? storeItem.description;
  // Pass title for keyword-based subcategory inference
  const resolvedCat = await resolveInwCategoryFromEbayPath(details.categoryName ?? null, remoteTitle);
  const remoteQty = details.quantity ?? storeItem.quantity;
  const remotePrice =
    details.priceCents != null && details.priceCents > 0
      ? details.priceCents
      : storeItem.priceCents;

  const changes: string[] = [];
  const updateData: Record<string, unknown> = {};
  const skipContent = opts?.skipContent === true;

  if (!skipContent && remoteTitle && remoteTitle !== storeItem.title) {
    updateData.title = remoteTitle;
    changes.push("title");
  }

  if (!skipContent && details.condition && details.condition !== storeItem.condition) {
    updateData.condition = details.condition;
    changes.push(`condition (${details.condition})`);
  }

  if (!skipContent && details.conditionEnum && details.conditionEnum !== storeItem.ebayConditionEnum) {
    updateData.ebayConditionEnum = details.conditionEnum;
    changes.push(`ebay condition (${details.conditionEnum})`);
  }

  if (
    !skipContent &&
    aspectsForStorage.length > 0 &&
    ebayAspectsFingerprint(aspectsForStorage) !== ebayAspectsFingerprint(storeItem.aspects)
  ) {
    updateData.aspects = aspectsForStorage as object;
    changes.push(`aspects (${aspectsForStorage.length} fields)`);
  }

  // GetItem PictureURL often echoes Etsy/INW hosts. Never replace INW Blob photos
  // with marketplace CDN derivatives; imported CDN listings can still upgrade.
  const inboundPhotos = selectInboundListingPhotos(storeItem.photos, photos);
  if (
    !skipContent &&
    shouldApplyEbayInboundPhotos({
      incoming: photos,
      current: storeItem.photos,
      force: opts?.force === true,
    }) &&
    !photosEqual(inboundPhotos, storeItem.photos)
  ) {
    updateData.photos = inboundPhotos;
    changes.push(`photos (${inboundPhotos.length})`);
  }

  if (!skipContent && description && description !== storeItem.description) {
    updateData.description = description;
    changes.push("description");
  }

  if (!skipContent && remotePrice !== storeItem.priceCents) {
    updateData.priceCents = remotePrice;
    changes.push(`price ($${(remotePrice / 100).toFixed(2)})`);
  }

  if (!skipContent && details.acceptOffers !== storeItem.acceptOffers) {
    updateData.acceptOffers = details.acceptOffers;
    changes.push(details.acceptOffers ? "acceptOffers (on)" : "acceptOffers (off)");
  }
  const remoteMin = details.minOfferCents ?? null;
  if (!skipContent && remoteMin !== storeItem.minOfferCents) {
    updateData.minOfferCents = remoteMin;
    changes.push(
      remoteMin != null ? `minOffer ($${(remoteMin / 100).toFixed(2)})` : "minOffer (none)"
    );
  }

  if (!opts?.skipQuantity && remoteQty !== storeItem.quantity) {
    const unsoldZero = ebayGetItemQtyIsUnsoldZero({
      listingEnded: details.listingEnded,
      quantitySold: details.quantitySold,
      quantity: remoteQty,
    });
    if (unsoldZero) {
      console.warn("[ebay] skip GetItem qty 0 on an active listing with no QuantitySold", {
        storeItemId: storeItem.id,
        legacyItemId,
        remoteQty,
        quantitySold: details.quantitySold,
      });
    } else {
      updateData.quantity = remoteQty;
      updateData.status = remoteQty > 0 ? "active" : "sold_out";
      changes.push(`quantity (${remoteQty})`);
    }
  }

  if (!skipContent && details.variants && details.variants.length > 0) {
    updateData.variants = details.variants as object;
    const sum = details.variants.reduce(
      (acc, axis) => acc + axis.options.reduce((s, o) => s + o.quantity, 0),
      0
    );
    // Prefer summed variant qty when variations are present (unless sale path skipped qty).
    if (!opts?.skipQuantity && sum !== storeItem.quantity) {
      const unsoldZero = ebayGetItemQtyIsUnsoldZero({
        listingEnded: details.listingEnded,
        quantitySold: details.quantitySold,
        quantity: sum,
      });
      if (!unsoldZero) {
        updateData.quantity = sum;
        updateData.status = sum > 0 ? "active" : "sold_out";
      }
    }
    changes.push("variants");
  }

  if (!skipContent && resolvedCat) {
    const subMissing = !storeItem.subcategory?.trim();
    const subInvalid =
      Boolean(storeItem.subcategory?.trim()) &&
      !isValidPresetSubcategory(storeItem.category, storeItem.subcategory);
    const categoryChanged = resolvedCat.category !== storeItem.category;
    if (categoryChanged || subMissing || subInvalid) {
      updateData.category = resolvedCat.category;
      updateData.subcategory = resolvedCat.subcategory;
      changes.push(
        categoryChanged
          ? `category (${resolvedCat.category})`
          : `subcategory (${resolvedCat.subcategory ?? "none"})`
      );
    }
  }

  if (!skipContent && details.remoteCategoryId) {
    const catId = Number(details.remoteCategoryId);
    if (Number.isInteger(catId) && catId > 0 && catId !== storeItem.ebayCategoryId) {
      updateData.ebayCategoryId = catId;
    }
  }

  if (Object.keys(updateData).length > 0) {
    const updatedItem = await prisma.storeItem.update({
      where: { id: storeItem.id },
      data: updateData,
    });

    const contentChange = isEbayInboundContentChange(updateData);
    if (contentChange) {
      const contentHash = syncContentHash(updatedItem);
      const metaHash = syncMetaHash({
        category: updatedItem.category,
        subcategory: updatedItem.subcategory,
        secondaryCategory: updatedItem.secondaryCategory,
        shippingCostCents: updatedItem.shippingCostCents,
        variants: updatedItem.variants,
      });

      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: {
          syncBaselineHash: contentHash,
          syncBaselineMetaHash: metaHash,
          syncBaselineVariantsHash: variantsFingerprint(updatedItem.variants),
          syncBaselineQty: updatedItem.quantity,
          syncBaselineAt: details.remoteUpdatedAt ?? new Date(),
          lastInboundAt: new Date(),
          syncStatus: "synced",
          syncError: null,
          conflictDetails: withEbayPendingInbound(conflictDetails, null),
        },
      });
    }

    void fetchAndCacheEbayInventoryAspects(
      accessToken,
      link.id,
      link.externalListingId
    ).catch(() => {});

    console.log("[ebay] refreshEbayListingByItemId: updated", {
      storeItemId: storeItem.id,
      legacyItemId,
      changes,
      contentChange,
      fromEbay: {
        title: remoteTitle,
        priceCents: remotePrice,
        quantity: remoteQty,
      },
    });

    const soldOutOnThisApply =
      (typeof updateData.quantity === "number" && updateData.quantity === 0) ||
      updateData.status === "sold_out";
    const fanout = inboundContentFanoutKind({
      contentChange,
      soldOut: soldOutOnThisApply,
    });
    if (fanout === "inventory") {
      await syncInventoryToChannels(storeItem.id, { skipProviders: ["ebay"] });
    } else if (fanout === "content") {
      await updateStoreItemOnChannels(storeItem.id, { skipProviders: ["ebay"] });
    }

    return {
      storeItemId: storeItem.id,
      title: updatedItem.title,
      updated: contentChange,
      changes,
    };
  }

  void fetchAndCacheEbayInventoryAspects(
    accessToken,
    link.id,
    link.externalListingId
  ).catch(() => {});

  return {
    storeItemId: storeItem.id,
    title: storeItem.title,
    updated: false,
    changes: [],
  };
}

function readEbayPullCursor(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as { ebayPullCursor?: unknown }).ebayPullCursor;
  return typeof v === "string" && v ? v : null;
}

function withEbayPullCursor(config: unknown, cursor: string | null): Prisma.InputJsonValue {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as Record<string, unknown>) }
      : {};
  if (cursor) base.ebayPullCursor = cursor;
  else delete base.ebayPullCursor;
  return base as Prisma.InputJsonValue;
}

function rotateEbayLinks<T extends { id: string }>(
  links: T[],
  cursor: string | null,
  limit: number
): { batch: T[]; nextCursor: string | null } {
  if (links.length === 0) return { batch: [], nextCursor: null };
  let start = cursor ? links.findIndex((l) => l.id === cursor) : 0;
  if (start < 0) start = 0;
  const take = Math.min(limit, links.length);
  const batch: T[] = [];
  for (let i = 0; i < take; i++) {
    batch.push(links[(start + i) % links.length]!);
  }
  const nextIndex = (start + take) % links.length;
  return { batch, nextCursor: links[nextIndex]?.id ?? null };
}

/** Pull live GetItem data for linked eBay listings, rotating through the catalog. */
export async function pullEbayUpdatesForConnection(
  connection: ConnectionRow
): Promise<{ updated: PullResult[]; checked: number }> {
  if (connection.provider !== "ebay") {
    return { updated: [], checked: 0 };
  }

  const links = await prisma.channelListingLink.findMany({
    where: {
      connectionId: connection.id,
      provider: "ebay",
      syncEnabled: true,
    },
    select: {
      id: true,
      externalListingId: true,
    },
    orderBy: { id: "asc" },
  });

  if (links.length === 0) {
    return { updated: [], checked: 0 };
  }

  const { batch, nextCursor } = rotateEbayLinks(
    links,
    readEbayPullCursor(connection.config),
    EBAY_CRON_GETITEM_LIMIT
  );

  const pulled = await withConnectionAuthRetry(connection, async (ctx) => {
    let accessToken = ctx.accessToken;
    const results: PullResult[] = [];
    let refreshedThisPass = false;

    for (const link of batch) {
      let legacyId = link.externalListingId;
      const inwMatch = legacyId.match(/^inw(\d+)$/);
      if (inwMatch) {
        legacyId = inwMatch[1];
      }

      try {
        // GetItem is the live listing (same as the public item page). Do not gate on
        // GetMyeBaySelling ActiveList — that seller-list call can lag minutes behind a revise.
        const result = await refreshEbayListingByItemId(accessToken, legacyId);
        if (result && result.updated) {
          results.push(result);
        }
      } catch (e) {
        console.error("[ebay] pullEbayUpdatesForConnection: failed to refresh", {
          legacyId,
          error: e instanceof Error ? e.message : String(e),
        });
        if (isChannelAuthError("ebay", e) && connection.refreshTokenEncrypted && !refreshedThisPass) {
          try {
            accessToken = await refreshConnectionToken(connection.id, "ebay");
            refreshedThisPass = true;
            const result = await refreshEbayListingByItemId(accessToken, legacyId);
            if (result && result.updated) {
              results.push(result);
            }
          } catch (retryErr) {
            console.error("[ebay] pullEbayUpdatesForConnection: retry after token refresh failed", {
              legacyId,
              error: retryErr instanceof Error ? retryErr.message : String(retryErr),
            });
          }
        }
      }
    }

    return {
      updated: results,
      checked: batch.length,
    };
  });

  await prisma.channelConnection
    .update({
      where: { id: connection.id },
      data: { config: withEbayPullCursor(connection.config, nextCursor) },
    })
    .catch(() => {});

  return pulled;
}
