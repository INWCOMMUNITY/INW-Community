import { prisma, Prisma } from "database";
import {
  withConnectionAuthRetry,
  isChannelAuthError,
  refreshConnectionToken,
  patchChannelConnectionConfig,
} from "../connection";
import {
  ebayGetItemMarksInwSoldOut,
  ebayGetItemQtyIsUnsoldZero,
  enumerateEbayListings,
  fetchEbayItemDetails,
  type EbayTradingListing,
} from "./trading";
import { resolveEbayLegacyListingId } from "./mapping";
import {
  ebayNotificationPostcardWrites,
  ebayPostcardDiffersFromStoreItem,
  type EbayNotificationPostcard,
} from "./notification-parse";
import {
  inboundDescriptionsMatch,
  remoteTitleOrPriceDiffersFromStoreItem,
} from "../apply-remote-listing";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { ebayAspectsFingerprint } from "./ebay-compat";
import { fetchAndCacheEbayInventoryAspects } from "./inventory-aspects-cache";
import { normalizeEbayPhotoUrl, shouldApplyEbayInboundPhotos } from "./photos";
import { selectInboundListingPhotos } from "../photo-urls";
import { storeListingDescription } from "../import-listing";
import { resolveInwCategoryFromEbayPath } from "../category-resolver";
import { isValidPresetSubcategory } from "../repair-categories";
import { syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "../sync-baseline";
import { normalizeVariantsFromProvider, variantsFingerprint } from "../variant-sync";
import { hasOptionQuantities } from "@/lib/store-item-variants";
import type { EbayVariationAxis } from "./item-specifics";
import { applyRemoteListingRemoved } from "../apply-remote-listing";
import { syncInventoryToChannels } from "../sync-inventory";
import { updateStoreItemOnChannels } from "../outbound";
import {
  inboundContentFanoutKind,
  persistEbayListingActive,
  persistEbayListingEnded,
  persistRemoteDeletedPending,
  clearRemoteDeletedNoticeIfSet,
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

/** How many GetItem calls one cron pass makes as a description/photo backstop. */
export const EBAY_CRON_GETITEM_LIMIT = 5;

/** Cap dirty-list GetItems so a mismatched seller list cannot crawl the whole shop. */
export const EBAY_CRON_DIRTY_GETITEM_LIMIT = 20;

/**
 * After an Etsy/Wix inbound edit, GetItem can briefly look Ended (lag, HTML
 * contamination, ActiveList miss). Do not unlink eBay in that window.
 */
export const EBAY_REMOTE_DELETED_ECHO_MS = 15 * 60 * 1000;

/**
 * Only treat a GetItem row as gone when ListingStatus is Ended/Completed,
 * quantity is not still in stock, and we did not just write INW from another shop.
 */
export function ebayGetItemEndedDecision(args: {
  listingEnded: boolean;
  quantity: number | null;
  inwUpdatedAt: Date | null;
  lastPushedAt?: Date | null;
  now?: Date;
}): "active" | "ended" {
  if (!args.listingEnded) return "active";
  if (args.quantity != null && args.quantity > 0) return "active";
  const nowMs = args.now?.getTime() ?? Date.now();
  const inwAt = args.inwUpdatedAt?.getTime() ?? 0;
  const pushedAt = args.lastPushedAt?.getTime() ?? 0;
  if (inwAt > 0 && nowMs - inwAt < EBAY_REMOTE_DELETED_ECHO_MS) return "active";
  if (pushedAt > 0 && nowMs - pushedAt < EBAY_REMOTE_DELETED_ECHO_MS) return "active";
  return "ended";
}

/** Metadata-only GetItem writes must not start the echo window. */
const EBAY_INBOUND_META_KEYS = new Set(["ebayCategoryId", "category", "subcategory"]);

/**
 * After INW publishes a variation group, GetItem often returns a degraded snapshot
 * (qty 1 on every option, missing values). Applying that would wipe seller stock.
 */
export function shouldApplyEbayInboundVariants(args: {
  localVariants: unknown;
  remoteVariants: EbayVariationAxis[] | null | undefined;
  lastPushedAt?: Date | null;
  now?: Date;
}): boolean {
  const remote = args.remoteVariants;
  if (!remote?.length || !remote[0]?.options.length) return false;

  const local = normalizeVariantsFromProvider("ebay", args.localVariants);
  if (!local?.length || !hasOptionQuantities(local)) return true;

  const localPrimary = local[0]!;
  const remotePrimary = remote[0]!;
  const remoteValues = new Set(
    remotePrimary.options.map((option) => option.value.trim().toLowerCase()).filter(Boolean)
  );
  const localHasMissingRemote = localPrimary.options.some((option) => {
    const key = option.value.trim().toLowerCase();
    return key.length > 0 && !remoteValues.has(key);
  });
  if (localHasMissingRemote) return false;

  const remoteAllOne = remotePrimary.options.every((option) => option.quantity === 1);
  const localHasNonOne = localPrimary.options.some((option) => option.quantity !== 1);
  const pushedAt = args.lastPushedAt?.getTime();
  const nowMs = args.now?.getTime() ?? Date.now();
  if (
    remoteAllOne &&
    localHasNonOne &&
    pushedAt != null &&
    nowMs - pushedAt < EBAY_INBOUND_ECHO_MS
  ) {
    return false;
  }
  return true;
}

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

/** True when GetItem LastModified (or "now" if missing) is an echo of our own push. */
export function ebayGetItemIsPushEcho(args: {
  lastPushedAt?: Date | null;
  ebayLastModified?: Date | null;
  now?: Date;
}): boolean {
  const pushedAt = args.lastPushedAt?.getTime();
  if (pushedAt == null) return false;
  const modifiedAt = args.ebayLastModified?.getTime();
  if (modifiedAt != null) {
    return modifiedAt >= pushedAt - 5_000 && modifiedAt <= pushedAt + SYNC_ECHO_SKEW_MS;
  }
  const nowMs = args.now?.getTime() ?? Date.now();
  return nowMs - pushedAt < SYNC_ECHO_SKEW_MS;
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
  // ItemListed / publish_by_group often stamps LastModified several seconds
  // after we return — a 2s window let that snapshot overwrite INW with qty 1.
  // Do not use lastPushedAt as a floor — inventory qty pushes would then
  // hide real eBay revises that happened earlier in the same cron window.
  if (ebayGetItemIsPushEcho(args)) {
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

export type EbayGetItemApplySource = "webhook" | "cron" | "cron-dirty";

/** Webhook pings and dirty seller-list rows are a second signal — do not await-confirm. */
export function ebayApplyTrustsSingleSnapshot(source?: EbayGetItemApplySource): boolean {
  return source === "webhook" || source === "cron-dirty";
}

/**
 * GetItem often omits LastModifiedTime (only StartTime/EndTime). Cron rotate confirms a
 * new snapshot on two consecutive looks when LastModified is missing. A verified
 * Platform Notification or a dirty GetMyeBaySelling row skips await-confirm but still
 * ignores our own push echo.
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
  inwDescription?: string | null;
  remoteDescription?: string | null;
  pendingRemoteHash?: string | null;
  source?: EbayGetItemApplySource;
  now?: Date;
}): EbayGetItemApplyDecision {
  const inboundAt = args.lastInboundAt?.getTime() ?? null;
  const pushedAt = args.lastPushedAt?.getTime() ?? null;

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
  const descriptionProvided =
    args.inwDescription !== undefined || args.remoteDescription !== undefined;
  const descriptionDiffers =
    descriptionProvided && !inboundDescriptionsMatch(args.inwDescription, args.remoteDescription);

  // Verified ping or dirty seller-list row: apply a real field diff unless this is our push echo.
  if (ebayApplyTrustsSingleSnapshot(args.source)) {
    if (remoteHash === inwHash && !descriptionDiffers) {
      return { action: "skip", reason: "matches-inw" };
    }
    if (ebayGetItemIsPushEcho(args)) {
      return { action: "skip", reason: "echo-of-push" };
    }
    return {
      action: "apply",
      reason: args.source === "cron-dirty" ? "dirty-revise" : "webhook-revise",
      pendingHash: remoteHash,
    };
  }

  if (args.ebayLastModified != null) {
    return ebayGetItemIsStaleVersusInw(args)
      ? { action: "skip", reason: "lastModified-not-newer" }
      : { action: "apply", reason: "lastModified-newer" };
  }

  if (inboundAt == null && pushedAt == null) {
    return { action: "apply", reason: "first-pull" };
  }

  if (remoteHash === inwHash) {
    return { action: "skip", reason: "matches-inw" };
  }

  // Right after we pushed, GetItem may still show the previous listing.
  if (ebayGetItemIsPushEcho(args)) {
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
    source?: EbayGetItemApplySource;
    postcard?: EbayNotificationPostcard;
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
    inwDescription: storeItem.description,
    remoteDescription: details.description,
    pendingRemoteHash: readEbayPendingInboundHash(link.conflictDetails),
    source: opts?.source,
  });

  const endedDecision = ebayGetItemEndedDecision({
    listingEnded: details.listingEnded,
    quantity: details.quantity,
    inwUpdatedAt: storeItem.updatedAt,
    lastPushedAt: link.lastPushedAt,
  });
  if (details.listingEnded && endedDecision === "active") {
    console.warn("[ebay] refreshEbayListingByItemId: GetItem said ended but listing looks live — keep eBay linked", {
      storeItemId: storeItem.id,
      legacyItemId,
      listingEnded: details.listingEnded,
      quantity: details.quantity,
      quantitySold: details.quantitySold,
      forcedInactive: opts?.activeListingIds != null && !opts.activeListingIds.has(legacyItemId),
    });
  }

  if (endedDecision === "ended") {
    if (!ebayGetItemMarksInwSoldOut(details)) {
      console.log("[ebay] refreshEbayListingByItemId: listing ended without a sale; keep INW listed", {
        storeItemId: storeItem.id,
        legacyItemId,
        listingEnded: details.listingEnded,
        quantitySold: details.quantitySold,
        quantity: details.quantity,
      });
      const endedDetails = await persistEbayListingEnded(link.id, link.conflictDetails);
      if (storeItem.status !== "sold_out" && storeItem.status !== "inactive") {
        await persistRemoteDeletedPending({
          linkId: link.id,
          conflictDetails: endedDetails,
          provider: "ebay",
        });
      }
      return {
        storeItemId: storeItem.id,
        title: storeItem.title,
        updated: false,
        changes: ["ended_without_sale"],
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
  await clearRemoteDeletedNoticeIfSet(link.id, conflictDetails);

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
      source: opts?.source ?? "cron",
      reason: applyDecision.reason,
      lastInboundAt: link.lastInboundAt?.toISOString() ?? null,
      lastPushedAt: link.lastPushedAt?.toISOString() ?? null,
      inwUpdatedAt: storeItem.updatedAt.toISOString(),
      ebayLastModified: details.remoteUpdatedAt?.toISOString() ?? null,
      getItemTitle: details.title,
      getItemPriceCents: details.priceCents,
      getItemQuantity: details.quantity,
    });
    if (
      applyDecision.reason === "matches-inw" &&
      opts?.source === "webhook" &&
      opts.postcard &&
      ebayPostcardDiffersFromStoreItem(storeItem, opts.postcard)
    ) {
      console.log("[ebay] refreshEbayListingByItemId: GetItem matched INW; applying webhook postcard", {
        storeItemId: storeItem.id,
        legacyItemId,
      });
      return applyEbayXmlPostcard({ itemId: legacyItemId, postcard: opts.postcard });
    }
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

  const applyRemoteVariants = shouldApplyEbayInboundVariants({
    localVariants: storeItem.variants,
    remoteVariants: details.variants,
    lastPushedAt: link.lastPushedAt,
  });

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
    } else if (details.variants?.length && !applyRemoteVariants) {
      console.warn("[ebay] skip GetItem listing qty; variation snapshot looks like a post-publish echo", {
        storeItemId: storeItem.id,
        legacyItemId,
        remoteQty,
        inwQuantity: storeItem.quantity,
      });
    } else {
      updateData.quantity = remoteQty;
      updateData.status = remoteQty > 0 ? "active" : "sold_out";
      changes.push(`quantity (${remoteQty})`);
    }
  }

  if (!skipContent && applyRemoteVariants && details.variants && details.variants.length > 0) {
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
      source: opts?.source ?? "cron",
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

/**
 * Apply title/price only from a verified notification snapshot when GetItem failed.
 * Never writes qty, photos, description, aspects, variations, or Ended.
 */
export async function applyEbayXmlPostcard(args: {
  itemId: string;
  postcard: EbayNotificationPostcard;
}): Promise<PullResult | null> {
  const writes = ebayNotificationPostcardWrites(args.postcard);
  if (!writes.title && writes.priceCents == null) return null;

  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider: "ebay",
      OR: [
        { externalListingId: args.itemId },
        { externalListingId: `inw${args.itemId}` },
      ],
    },
    include: {
      storeItem: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          quantity: true,
          category: true,
          subcategory: true,
          secondaryCategory: true,
          shippingCostCents: true,
          variants: true,
        },
      },
    },
  });
  if (!link?.storeItem) return null;

  const updateData: Record<string, unknown> = {};
  const changes: string[] = [];
  if (writes.title && writes.title !== link.storeItem.title) {
    updateData.title = writes.title.slice(0, 200);
    changes.push("title");
  }
  if (writes.priceCents != null && writes.priceCents !== link.storeItem.priceCents) {
    updateData.priceCents = writes.priceCents;
    changes.push(`price ($${(writes.priceCents / 100).toFixed(2)})`);
  }
  if (Object.keys(updateData).length === 0) {
    return {
      storeItemId: link.storeItem.id,
      title: link.storeItem.title,
      updated: false,
      changes: [],
    };
  }

  const updatedItem = await prisma.storeItem.update({
    where: { id: link.storeItem.id },
    data: updateData,
  });
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
      syncBaselineAt: args.postcard.lastModified ?? new Date(),
      lastInboundAt: new Date(),
      syncStatus: "synced",
      syncError: null,
    },
  });
  console.log("[ebay] xml postcard", {
    storeItemId: updatedItem.id,
    itemId: args.itemId,
    changes,
  });
  await updateStoreItemOnChannels(updatedItem.id, { skipProviders: ["ebay"] });
  return {
    storeItemId: updatedItem.id,
    title: updatedItem.title,
    updated: true,
    changes,
  };
}

function readEbayPullCursor(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as { ebayPullCursor?: unknown }).ebayPullCursor;
  return typeof v === "string" && v ? v : null;
}

async function persistEbayPullCursor(connectionId: string, cursor: string | null): Promise<void> {
  if (cursor) {
    await patchChannelConnectionConfig(connectionId, { ebayPullCursor: cursor });
    return;
  }
  await patchChannelConnectionConfig(connectionId, {}, ["ebayPullCursor"]);
}

/** GetMyeBaySelling title/price/qty vs INW — list is a dirty detector, not source of truth. */
export function ebaySellerListRowIsDirty(
  inw: { title: string; priceCents: number; quantity: number },
  remote: { title: string; priceCents: number; quantity: number }
): boolean {
  if (remoteTitleOrPriceDiffersFromStoreItem(inw, remote)) return true;
  return remote.quantity !== inw.quantity;
}

export function rotateEbayLinks<T extends { id: string }>(
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

function indexEbaySellerList(listings: EbayTradingListing[]): Map<string, EbayTradingListing> {
  const byId = new Map<string, EbayTradingListing>();
  for (const listing of listings) {
    byId.set(listing.listingId, listing);
    byId.set(`inw${listing.listingId}`, listing);
    if (listing.sku?.trim()) byId.set(listing.sku.trim(), listing);
  }
  return byId;
}

async function refreshEbayListingWithAuthRetry(
  connection: ConnectionRow,
  accessToken: string,
  legacyId: string,
  refreshedThisPass: boolean,
  source: EbayGetItemApplySource,
  logKind: "cron dirty GetItem" | "cron rotate"
): Promise<{ result: PullResult | null; accessToken: string; refreshedThisPass: boolean }> {
  try {
    const result = await refreshEbayListingByItemId(accessToken, legacyId, { source });
    if (result) {
      console.log(`[ebay] ${logKind}`, {
        legacyId,
        updated: result.updated,
        changes: result.changes,
        reason: result.updated ? "applied" : "no-write",
      });
    }
    return { result, accessToken, refreshedThisPass };
  } catch (e) {
    console.error("[ebay] pullEbayUpdatesForConnection: failed to refresh", {
      legacyId,
      logKind,
      error: e instanceof Error ? e.message : String(e),
    });
    if (isChannelAuthError("ebay", e) && connection.refreshTokenEncrypted && !refreshedThisPass) {
      try {
        const nextToken = await refreshConnectionToken(connection.id, "ebay");
        const result = await refreshEbayListingByItemId(nextToken, legacyId, { source });
        if (result) {
          console.log(`[ebay] ${logKind}`, {
            legacyId,
            updated: result.updated,
            changes: result.changes,
            reason: result.updated ? "applied" : "no-write",
          });
        }
        return { result, accessToken: nextToken, refreshedThisPass: true };
      } catch (retryErr) {
        console.error("[ebay] pullEbayUpdatesForConnection: retry after token refresh failed", {
          legacyId,
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
      }
    }
    return { result: null, accessToken, refreshedThisPass };
  }
}

/** Hybrid inbound: cheap seller list finds dirty rows, then a small GetItem rotate. */
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
      storeItem: { select: { title: true, priceCents: true, quantity: true } },
    },
    orderBy: { id: "asc" },
  });

  if (links.length === 0) {
    return { updated: [], checked: 0 };
  }

  const pulled = await withConnectionAuthRetry(connection, async (ctx) => {
    let accessToken = ctx.accessToken;
    let refreshedThisPass = false;
    const results: PullResult[] = [];
    const checkedIds = new Set<string>();

    let sellerList: EbayTradingListing[] = [];
    try {
      sellerList = await enumerateEbayListings(accessToken, { skipPhotoEnrichment: true });
    } catch (e) {
      console.warn("[ebay] GetMyeBaySelling dirty scan failed; rotate-only this tick", {
        connectionId: connection.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const byRemote = indexEbaySellerList(sellerList);
    const dirty: typeof links = [];
    for (const link of links) {
      const remote =
        byRemote.get(link.externalListingId) ??
        (resolveEbayLegacyListingId(link.externalListingId)
          ? byRemote.get(resolveEbayLegacyListingId(link.externalListingId)!)
          : undefined);
      if (!remote) continue;
      if (
        ebaySellerListRowIsDirty(
          {
            title: link.storeItem.title,
            priceCents: link.storeItem.priceCents,
            quantity: link.storeItem.quantity,
          },
          {
            title: remote.title,
            priceCents: remote.priceCents,
            quantity: remote.quantity,
          }
        )
      ) {
        dirty.push(link);
      }
    }

    const dirtyThisTick = dirty.slice(0, EBAY_CRON_DIRTY_GETITEM_LIMIT);
    if (dirty.length > dirtyThisTick.length) {
      console.warn("[ebay] dirty GetItem cap hit; leftover wait for next tick", {
        connectionId: connection.id,
        dirty: dirty.length,
        capped: dirtyThisTick.length,
      });
    }

    for (const link of dirtyThisTick) {
      const legacyId =
        resolveEbayLegacyListingId(link.externalListingId) ?? link.externalListingId.replace(/^inw/i, "");
      checkedIds.add(link.id);
      const next = await refreshEbayListingWithAuthRetry(
        connection,
        accessToken,
        legacyId,
        refreshedThisPass,
        "cron-dirty",
        "cron dirty GetItem"
      );
      accessToken = next.accessToken;
      refreshedThisPass = next.refreshedThisPass;
      if (next.result?.updated) results.push(next.result);
    }

    const { batch, nextCursor } = rotateEbayLinks(
      links,
      readEbayPullCursor(connection.config),
      EBAY_CRON_GETITEM_LIMIT
    );

    for (const link of batch) {
      if (checkedIds.has(link.id)) continue;
      const legacyId =
        resolveEbayLegacyListingId(link.externalListingId) ?? link.externalListingId.replace(/^inw/i, "");
      checkedIds.add(link.id);
      const next = await refreshEbayListingWithAuthRetry(
        connection,
        accessToken,
        legacyId,
        refreshedThisPass,
        "cron",
        "cron rotate"
      );
      accessToken = next.accessToken;
      refreshedThisPass = next.refreshedThisPass;
      if (next.result?.updated) results.push(next.result);
    }

    await persistEbayPullCursor(connection.id, nextCursor).catch(() => {});

    return {
      updated: results,
      checked: checkedIds.size,
    };
  });

  return pulled;
}
