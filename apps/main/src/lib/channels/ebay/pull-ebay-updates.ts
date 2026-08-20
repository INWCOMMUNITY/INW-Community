import { prisma } from "database";
import { withConnectionAuthRetry, isChannelAuthError } from "../connection";
import { fetchEbayItemDetails } from "./trading";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { fetchAndCacheEbayInventoryAspects } from "./inventory-aspects-cache";
import { isImportedEbayLink } from "./listing-origin";
import { normalizeEbayPhotoUrl } from "./photos";
import { storeListingDescription } from "../import-listing";
import { resolveInwCategoryFromEbayPath } from "../category-resolver";
import { isValidPresetSubcategory } from "../repair-categories";
import { syncContentHash, syncMetaHash } from "../sync-baseline";
import { variantsFingerprint } from "../variant-sync";
import { applyRemoteListingRemoved } from "../apply-remote-listing";
import { syncInventoryToChannels } from "../sync-inventory";
import { ebayAspectsFingerprint } from "./ebay-compat";

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

function debugEbayCron(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  // #region agent log
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4f2763" },
    body: JSON.stringify({
      sessionId: "4f2763",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

/**
 * Ignore a lagged GetItem after a refresh when LastModified is missing.
 * Cron is every 5 minutes, so this must span more than one job or the next
 * run will copy a stale replica over a good pull.
 */
export const EBAY_INBOUND_ECHO_MS = 15 * 60 * 1000;

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
  inwUpdatedAt: Date | null;
  ebayLastModified?: Date | null;
  now?: Date;
}): boolean {
  const now = args.now?.getTime() ?? Date.now();
  const inwAt = (args.lastInboundAt ?? args.inwUpdatedAt)?.getTime();
  if (inwAt == null) return false;
  const modifiedAt = args.ebayLastModified?.getTime();
  // Never apply a GetItem that is older than (or equal to) the last inbound pull,
  // even after the echo window. That is the TEST 5 → original-title revert.
  if (modifiedAt != null && modifiedAt <= inwAt + 2000) {
    return true;
  }
  if (modifiedAt != null && modifiedAt > inwAt + 2000) {
    return false;
  }
  return now - inwAt <= EBAY_INBOUND_ECHO_MS;
}

/**
 * Pull latest data from eBay for a single listing by legacy item ID.
 * Used by webhook handler and manual refresh.
 */
export async function refreshEbayListingByItemId(
  accessToken: string,
  legacyItemId: string,
  opts?: { activeListingIds?: Set<string>; skipQuantity?: boolean; force?: boolean }
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
    debugEbayCron("H-B", "pull-ebay-updates.ts:unusableGetItem", "GetItem returned no listing fields", {
      legacyItemId,
      listingEnded: details.listingEnded,
    });
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
  const staleVersusInw = ebayGetItemIsStaleVersusInw({
    lastInboundAt: link.lastInboundAt,
    inwUpdatedAt: storeItem.updatedAt,
    ebayLastModified: details.remoteUpdatedAt,
  });
  debugEbayCron("H-A", "pull-ebay-updates.ts:refreshEbayListingByItemId", "GetItem vs INW snapshot", {
    legacyItemId,
    force: Boolean(opts?.force),
    staleVersusInw,
    lastInboundAt: link.lastInboundAt?.toISOString() ?? null,
    inwUpdatedAt: storeItem.updatedAt.toISOString(),
    inwTitle: storeItem.title,
    inwPriceCents: storeItem.priceCents,
    inwQty: storeItem.quantity,
    getItemTitle: details.title,
    getItemPriceCents: details.priceCents,
    getItemQty: details.quantity,
    ebayLastModified: details.remoteUpdatedAt?.toISOString() ?? null,
    listingEnded: details.listingEnded,
  });

  const stillActive =
    opts?.activeListingIds != null
      ? opts.activeListingIds.has(legacyItemId)
      : !details.listingEnded;

  if (!stillActive || details.listingEnded) {
    await applyRemoteListingRemoved(storeItem.id);
    await syncInventoryToChannels(storeItem.id, { skipProviders: ["ebay"] });
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        lastInboundAt: new Date(),
        syncStatus: "synced",
        syncError: null,
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

  if (
    !opts?.force &&
    ebayGetItemIsStaleVersusInw({
      lastInboundAt: link.lastInboundAt,
      inwUpdatedAt: storeItem.updatedAt,
      ebayLastModified: details.remoteUpdatedAt,
    })
  ) {
    debugEbayCron("H-A", "pull-ebay-updates.ts:staleSkip", "skipped GetItem apply due to echo window", {
      storeItemId: storeItem.id,
      legacyItemId,
      getItemTitle: details.title,
      getItemPriceCents: details.priceCents,
    });
    console.log("[ebay] refreshEbayListingByItemId: skip GetItem after recent INW inbound", {
      storeItemId: storeItem.id,
      legacyItemId,
      lastInboundAt: link.lastInboundAt?.toISOString() ?? null,
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

  if (remoteTitle && remoteTitle !== storeItem.title) {
    updateData.title = remoteTitle;
    changes.push("title");
  }

  if (details.condition && details.condition !== storeItem.condition) {
    updateData.condition = details.condition;
    changes.push(`condition (${details.condition})`);
  }

  if (details.conditionEnum && details.conditionEnum !== storeItem.ebayConditionEnum) {
    updateData.ebayConditionEnum = details.conditionEnum;
    changes.push(`ebay condition (${details.conditionEnum})`);
  }

  if (
    aspectsForStorage.length > 0 &&
    ebayAspectsFingerprint(aspectsForStorage) !== ebayAspectsFingerprint(storeItem.aspects)
  ) {
    updateData.aspects = aspectsForStorage as object;
    changes.push(`aspects (${aspectsForStorage.length} fields)`);
  }

  // Authoritative photo set from GetItem (may shrink when seller removes images).
  if (photos.length > 0 && !photosEqual(photos, storeItem.photos)) {
    updateData.photos = photos;
    changes.push(`photos (${photos.length})`);
  }

  if (description && description !== storeItem.description) {
    updateData.description = description;
    changes.push("description");
  }

  if (remotePrice !== storeItem.priceCents) {
    updateData.priceCents = remotePrice;
    changes.push(`price ($${(remotePrice / 100).toFixed(2)})`);
  }

  if (details.acceptOffers !== storeItem.acceptOffers) {
    updateData.acceptOffers = details.acceptOffers;
    changes.push(details.acceptOffers ? "acceptOffers (on)" : "acceptOffers (off)");
  }
  const remoteMin = details.minOfferCents ?? null;
  if (remoteMin !== storeItem.minOfferCents) {
    updateData.minOfferCents = remoteMin;
    changes.push(
      remoteMin != null ? `minOffer ($${(remoteMin / 100).toFixed(2)})` : "minOffer (none)"
    );
  }

  if (!opts?.skipQuantity && remoteQty !== storeItem.quantity) {
    updateData.quantity = remoteQty;
    updateData.status = remoteQty > 0 ? "active" : "sold_out";
    changes.push(`quantity (${remoteQty})`);
  }

  if (details.variants && details.variants.length > 0) {
    updateData.variants = details.variants as object;
    const sum = details.variants.reduce(
      (acc, axis) => acc + axis.options.reduce((s, o) => s + o.quantity, 0),
      0
    );
    // Prefer summed variant qty when variations are present (unless sale path skipped qty).
    if (!opts?.skipQuantity && sum !== storeItem.quantity) {
      updateData.quantity = sum;
      updateData.status = sum > 0 ? "active" : "sold_out";
    }
    changes.push("variants");
  }

  if (resolvedCat) {
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

  if (details.remoteCategoryId) {
    const catId = Number(details.remoteCategoryId);
    if (Number.isInteger(catId) && catId > 0 && catId !== storeItem.ebayCategoryId) {
      updateData.ebayCategoryId = catId;
    }
  }

  debugEbayCron("H-B", "pull-ebay-updates.ts:applyDecision", "field diff after GetItem parse", {
    storeItemId: storeItem.id,
    legacyItemId,
    changes,
    willWrite: Object.keys(updateData).length > 0,
    contentChange: isEbayInboundContentChange(updateData),
    updateKeys: Object.keys(updateData),
    remoteTitle,
    remotePrice,
    remoteQty,
  });

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

/**
 * Pull updates from eBay for all linked listings for a connection.
 * Returns a list of items that were updated.
 */
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
      externalListingId: true,
    },
  });

  debugEbayCron("H-C", "pull-ebay-updates.ts:pullStart", "ebay GetItem pull starting", {
    connectionId: connection.id,
    linkCount: links.length,
    cronPassesForce: false,
  });

  if (links.length === 0) {
    return { updated: [], checked: 0 };
  }

  return withConnectionAuthRetry(connection, async (ctx) => {
    const results: PullResult[] = [];

    for (const link of links) {
      let legacyId = link.externalListingId;
      const inwMatch = legacyId.match(/^inw(\d+)$/);
      if (inwMatch) {
        legacyId = inwMatch[1];
      }

      try {
        // GetItem is the live listing (same as the public item page). Do not gate on
        // GetMyeBaySelling ActiveList — that seller-list call can lag minutes behind a revise.
        const result = await refreshEbayListingByItemId(ctx.accessToken, legacyId);
        if (result && result.updated) {
          results.push(result);
        }
      } catch (e) {
        debugEbayCron("H-C", "pull-ebay-updates.ts:pullError", "GetItem refresh threw", {
          legacyId,
          error: e instanceof Error ? e.message : String(e),
        });
        console.error("[ebay] pullEbayUpdatesForConnection: failed to refresh", {
          legacyId,
          error: e instanceof Error ? e.message : String(e),
        });
        if (isChannelAuthError("ebay", e)) throw e;
      }
    }

    return {
      updated: results,
      checked: links.length,
    };
  });
}
