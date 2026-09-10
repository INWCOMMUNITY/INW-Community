import { createHash } from "crypto";
import { variantsFingerprint } from "./variant-sync";
import { ebayAspectsFingerprint } from "./ebay/ebay-compat";
import { photosFingerprintForSyncHash } from "./photo-urls";
import { listingDescriptionToPlainText } from "./rich-description";
import type { SyncStoreItem } from "./types";

/**
 * Differential two-way sync helpers.
 *
 * The reconciler stores a per-link baseline (content hash + quantity + timestamp) representing the
 * last agreed state between INW and the channel. On each pass it detects which side changed since
 * that baseline and pushes/pulls accordingly. When BOTH sides changed, the most-recently-edited side
 * wins. This replaces value-equality comparisons (which thrash because Wix re-hosts photos) and the
 * old "push when local is 0" rule (which wiped remote restocks).
 */

/** Fields that participate in INW <-> channel content sync (quantity is tracked separately). */
export type SyncContentInput = {
  title: string;
  description: string | null;
  priceCents: number;
  photos: string[];
};

export type StoreItemContentFieldFlags = {
  title: boolean;
  description: boolean;
  photos: boolean;
  price: boolean;
  bestOffer: boolean;
};

/** Full StoreItem fingerprint used for lastPushedHash / skip-no-op content pushes. */
export function storeItemContentHash(item: SyncStoreItem): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        t: item.title,
        d: item.description,
        p: item.priceCents,
        q: item.quantity,
        s: item.status,
        ph: item.photos,
        v: item.variants,
        c: item.condition,
        ewm: item.etsyWhoMade,
        eww: item.etsyWhenMade,
        eis: item.etsyIsSupply,
        etx: item.etsyTaxonomyId,
        ebc: item.ebayCategoryId,
        cat: item.category,
        sub: item.subcategory,
        sc: item.secondaryCategory,
        ship: item.shippingCostCents,
        asp: ebayAspectsFingerprint(item.aspects),
        ecc: item.ebayConditionEnum ?? null,
        ao: item.acceptOffers ?? true,
        moc: item.minOfferCents ?? null,
      })
    )
    .digest("hex");
}

/**
 * Which content fields changed since the last successful channel content push.
 * Uses the same hash as storeItemContentHash / lastPushedHash.
 */
export function detectStoreItemFieldChanges(
  item: SyncStoreItem,
  previousHash: string | null | undefined
): StoreItemContentFieldFlags {
  if (!previousHash) {
    return { title: true, description: true, photos: true, price: true, bestOffer: true };
  }
  const current = storeItemContentHash(item);
  if (current === previousHash) {
    return { title: false, description: false, photos: false, price: false, bestOffer: false };
  }
  return {
    title: storeItemContentHash({ ...item, title: "" }) !== previousHash,
    description: storeItemContentHash({ ...item, description: "" }) !== previousHash,
    photos: storeItemContentHash({ ...item, photos: [] }) !== previousHash,
    price: storeItemContentHash({ ...item, priceCents: 0 }) !== previousHash,
    bestOffer:
      storeItemContentHash({ ...item, acceptOffers: false, minOfferCents: null }) !== previousHash,
  };
}

/** Stable content fingerprint for one side (title, description, price, photos). */
export function syncContentHash(item: SyncContentInput): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        t: item.title ?? "",
        d: listingDescriptionToPlainText(item.description) ?? "",
        p: item.priceCents ?? 0,
        ph: photosFingerprintForSyncHash(Array.isArray(item.photos) ? item.photos : []),
      })
    )
    .digest("hex");
}

export type SyncDirection = "push" | "pull" | "noop";
export type ConflictResolution = "most_recent" | "inw_wins" | "manual_review";

/**
 * Hash mismatch vs baseline is not an INW edit. CDN/plaintext drift and hash
 * formula changes can desync the stored baseline without a StoreItem save.
 * Require a save after the last agreed baseline before treating INW as edited.
 */
export function inwChangedSinceBaseline(args: {
  hashDiffers: boolean;
  inwUpdatedAt: Date | null;
  baselineAt: Date | null;
}): boolean {
  if (!args.hashDiffers) return false;
  if (!args.inwUpdatedAt || !args.baselineAt) return args.hashDiffers;
  return args.inwUpdatedAt.getTime() > args.baselineAt.getTime();
}

/**
 * After an INW push the channel timestamp is newer than StoreItem.updatedAt.
 * Do not treat that echo as a marketplace edit that should overwrite INW.
 */
export function isSyncEchoWindow(baselineAt: Date | null, nowMs: number = Date.now()): boolean {
  return baselineAt != null && baselineAt.getTime() > nowMs;
}

/**
 * True when the seller saved on the channel after the last INW save.
 * Used to avoid inw_wins pushing a stale hub copy over a marketplace edit.
 *
 * Shop catalogs sometimes omit last_modified. If INW was not saved after the
 * last agreed baseline, a differing remote listing is treated as a marketplace
 * edit (unless we are still inside the post-push echo window).
 */
export function newerChannelEditShouldPull(args: {
  remoteContentDiffers: boolean;
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  baselineAt: Date | null;
}): boolean {
  if (!args.remoteContentDiffers) return false;
  if (isSyncEchoWindow(args.baselineAt)) return false;
  if (args.remoteUpdatedAt) {
    if (!args.inwUpdatedAt) return true;
    return args.remoteUpdatedAt.getTime() > args.inwUpdatedAt.getTime();
  }
  if (!args.inwUpdatedAt || !args.baselineAt) return true;
  return args.inwUpdatedAt.getTime() <= args.baselineAt.getTime();
}

/**
 * INW was saved after this channel's last successful content write.
 * Hash equality is not enough to skip — lastPushedHash can be stamped without
 * the marketplace listing actually receiving the new title/price.
 */
export function inwSavedAfterChannelPush(args: {
  inwUpdatedAt: Date | null;
  lastPushedAt: Date | null;
}): boolean {
  if (!args.inwUpdatedAt) return false;
  if (!args.lastPushedAt) return true;
  return args.inwUpdatedAt.getTime() > args.lastPushedAt.getTime();
}

/**
 * Last-write guard for outbound content pushes. If the live channel listing
 * differs (title, price, or description) and that listing was saved after the
 * hub timestamp, do not PATCH the old INW copy back.
 *
 * `inwUpdatedAt` should be the source shop's timestamp or pre-apply INW time —
 * not a post-apply wall clock from Shopify/eBay fan-out restamping StoreItem.
 */
export function shouldBlockOutboundOverwrite(args: {
  titlesDiffer: boolean;
  pricesDiffer?: boolean;
  descriptionsDiffer?: boolean;
  remoteUpdatedAt: Date | null | undefined;
  inwUpdatedAt: Date | null;
  lastPushedAt: Date | null;
  nowMs?: number;
}): boolean {
  const contentDiffers =
    args.titlesDiffer || Boolean(args.pricesDiffer) || Boolean(args.descriptionsDiffer);
  if (!contentDiffers) return false;
  const now = args.nowMs ?? Date.now();
  if (args.lastPushedAt && now - args.lastPushedAt.getTime() < SYNC_ECHO_SKEW_MS) {
    return false;
  }
  if (args.remoteUpdatedAt && args.inwUpdatedAt) {
    return args.remoteUpdatedAt.getTime() > args.inwUpdatedAt.getTime();
  }
  if (!args.inwUpdatedAt) return true;
  if (!args.lastPushedAt) return true;
  return args.inwUpdatedAt.getTime() <= args.lastPushedAt.getTime();
}

function titlesMatchForSync(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

/**
 * GetItem almost never includes LastModifiedTime. Live eBay is an independent
 * revise when it is neither INW nor the title we last synced. Requiring INW to
 * still equal lastSynced let Etsy restamp INW and then skip (or overwrite) the
 * eBay edit. A lagged GetItem after our own PUT still equals lastSynced, or is
 * suppressed by the inbound lag window.
 */
export function ebayRemoteLooksLikeIndependentRevise(args: {
  inwTitle: string;
  remoteTitle: string | null | undefined;
  lastSyncedTitle: string | null | undefined;
}): boolean {
  const remote = (args.remoteTitle ?? "").trim();
  const inw = args.inwTitle.trim();
  if (!remote || remote === inw) return false;
  const synced = (args.lastSyncedTitle ?? "").trim();
  if (!synced) return false;
  if (remote === synced) return false;
  return true;
}

export function shouldBlockEbayOutboundOverwrite(args: {
  inwTitle: string;
  remoteTitle: string | null | undefined;
  lastSyncedTitle: string | null | undefined;
  inwUpdatedAt: Date | null;
  lastPushedAt: Date | null;
  remoteUpdatedAt: Date | null | undefined;
  inwMatchesLastPushedHash?: boolean;
  nowMs?: number;
}): boolean {
  if (titlesMatchForSync(args.inwTitle, args.remoteTitle)) return false;
  if (args.remoteUpdatedAt) {
    return shouldBlockOutboundOverwrite({
      titlesDiffer: true,
      remoteUpdatedAt: args.remoteUpdatedAt,
      inwUpdatedAt: args.inwUpdatedAt,
      lastPushedAt: args.lastPushedAt,
      nowMs: args.nowMs,
    });
  }
  const now = args.nowMs ?? Date.now();
  if (args.lastPushedAt && now - args.lastPushedAt.getTime() < SYNC_ECHO_SKEW_MS) {
    return false;
  }
  if (ebayRemoteLooksLikeIndependentRevise(args)) return true;
  // Unstamped links: INW still fingerprints as the last eBay push, so the live
  // title change happened on eBay (often after another shop bumped updatedAt).
  if (args.inwMatchesLastPushedHash) return true;
  return shouldBlockOutboundOverwrite({
    titlesDiffer: true,
    remoteUpdatedAt: null,
    inwUpdatedAt: args.inwUpdatedAt,
    lastPushedAt: args.lastPushedAt,
    nowMs: args.nowMs,
  });
}

/**
 * Decide direction for a single aspect (content or quantity).
 * - only INW changed   -> push (INW -> channel)
 * - only channel changed -> pull (channel -> INW)
 * - both changed        -> depends on conflictResolution setting
 */
export function resolveSyncDirection(args: {
  inwChanged: boolean;
  remoteChanged: boolean;
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  conflictResolution?: ConflictResolution;
}): SyncDirection {
  const { inwChanged, remoteChanged, inwUpdatedAt, remoteUpdatedAt, conflictResolution = "most_recent" } = args;
  if (!inwChanged && !remoteChanged) return "noop";
  if (inwChanged && !remoteChanged) return "push";
  if (!inwChanged && remoteChanged) return "pull";

  // Both sides changed - apply conflict resolution strategy
  switch (conflictResolution) {
    case "inw_wins":
      // INW always wins conflicts - push our version
      return "push";
    case "manual_review":
      // For manual review, we skip auto-resolution (noop will be queued for review)
      // The caller should handle logging this as a conflict
      return "noop";
    case "most_recent":
    default:
      // Most recent edit wins (INW wins when channel timestamp is unknown)
      if (!remoteUpdatedAt) return "push";
      if (!inwUpdatedAt) return "pull";
      return inwUpdatedAt.getTime() >= remoteUpdatedAt.getTime() ? "push" : "pull";
  }
}

/**
 * After we push INW -> channel, the channel's updatedDate advances to ~now, which would look like
 * a remote edit on the next pass. Treat remote changes within this window after a push as our own echo.
 * Reduced from 120s to 45s since we now sync every ~30 seconds.
 */
export const SYNC_ECHO_SKEW_MS = 45_000;

/** Fields that participate in INW <-> channel meta sync (category, shipping, variants, eBay specifics). */
export type SyncMetaInput = {
  category: string | null;
  subcategory: string | null;
  secondaryCategory?: string | null;
  shippingCostCents: number | null;
  variants: unknown;
  aspects?: unknown;
  ebayConditionEnum?: string | null;
  acceptOffers?: boolean;
  minOfferCents?: number | null;
};

/** Stable fingerprint for category, shipping, product options, and eBay-specific fields. */
export function syncMetaHash(item: SyncMetaInput): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        c: item.category ?? "",
        s: item.subcategory ?? "",
        sc: item.secondaryCategory ?? "",
        sh: item.shippingCostCents ?? null,
        v: variantsFingerprint(item.variants),
        asp: ebayAspectsFingerprint(item.aspects),
        ecc: item.ebayConditionEnum ?? null,
        ao: item.acceptOffers ?? true,
        moc: item.minOfferCents ?? null,
      })
    )
    .digest("hex");
}
