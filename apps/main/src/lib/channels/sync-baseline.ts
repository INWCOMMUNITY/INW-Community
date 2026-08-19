import { createHash } from "crypto";
import { variantsFingerprint } from "./variant-sync";
import { ebayAspectsFingerprint } from "./ebay/ebay-compat";
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
        d: (item.description ?? "").trim(),
        p: item.priceCents ?? 0,
        ph: Array.isArray(item.photos) ? item.photos : [],
      })
    )
    .digest("hex");
}

export type SyncDirection = "push" | "pull" | "noop";
export type ConflictResolution = "most_recent" | "inw_wins" | "manual_review";

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
