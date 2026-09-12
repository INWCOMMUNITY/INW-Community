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
import {
  readEbayLastSyncedTitle,
  readEbayPendingVariantInboundHash,
  readLastPushedVariantPricesHash,
  withEbayLastSyncedTitle,
  withLastPushedVariantPricesHash,
} from "../listing-conflict-json";
import { ebayRemoteLooksLikeIndependentRevise, syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "../sync-baseline";
import {
  normalizeVariantsFromProvider,
  remoteVariantMatrixIsWeaker,
  variantPricesFingerprint,
  variantQuantitiesLookDegraded,
  variantsFingerprint,
  variantsStructureQtyFingerprint,
} from "../variant-sync";
import { hasOptionQuantities } from "@/lib/store-item-variants";
import {
  applyLiveInventoryQuantitiesToMatrix,
  applyRemoteVariantPricesToMatrix,
  inboundListingPriceCents,
  matrixHasKnownSkuPrices,
  normalizeVariantMatrix,
  optionValuesKey,
  serializeVariantMatrix,
  sumMatrixQuantities,
  type LiveVariantQuantity,
  type RemoteVariantPrice,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";
import { recordVariantPriceTrace, buildIntendedVariantPriceRows } from "../sync-trace";
import { fetchLiveInventoryItem, readLiveInventoryAvailableQuantity } from "./passthrough-push";
import { catchUpEbayLiveVariantQuantities, type EbayLiveQtyCatchUp } from "./variant-qty-catchup";
import { applyRemoteListingRemoved } from "../apply-remote-listing";
import { syncInventoryToChannels } from "../sync-inventory";
import { updateStoreItemOnChannels } from "../outbound";
import {
  inboundContentFanoutKind,
  persistEbayListingActive,
  persistEbayListingEnded,
  persistRemoteDeletedPending,
  clearRemoteDeletedNoticeIfSet,
  shouldSkipEndedEbayOutbound,
} from "../listing-link-flags";
import { attachShippingOptionOnImport } from "@/lib/shipping-options";
import { resolveInwCategoryFromEbayPath } from "../category-resolver";
import { isValidPresetSubcategory } from "../repair-categories";

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
 * Decide whether to apply an eBay GetItem variant snapshot onto INW.
 *
 * GetItem (Trading API) per-option quantities are an unreliable snapshot for variation listings:
 * after INW publishes a variation group eBay commonly returns degraded values — all-1s, mixed
 * degraded (e.g. {S:1, M:1, L:5}), or missing options — and applying any of these wipes real
 * seller stock and fans the wrong totals out to Etsy/Shopify every cron tick. eBay variation
 * stock must come from the Inventory API / offering stock, never GetItem.
 *
 * Rule: if INW already tracks real per-option quantities, NEVER overwrite them from GetItem.
 * Only adopt the GetItem variant structure when INW has no per-option stock to protect.
 */
export function shouldApplyEbayInboundVariants(args: {
  localVariants: unknown;
  remoteVariants: unknown;
}): boolean {
  const remote = normalizeVariantsFromProvider("ebay", args.remoteVariants);
  if (!remote?.length || !remote[0]?.options.length) return false;

  const local = normalizeVariantsFromProvider("ebay", args.localVariants);
  if (!local?.length || !hasOptionQuantities(local)) return true;

  // INW tracks real per-option stock — GetItem's per-option quantities are not trustworthy.
  return false;
}

const EBAY_INVENTORY_READ_CONCURRENCY = 4;

async function forEachInChunks<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const n = Math.max(1, size);
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map((item) => fn(item)));
  }
}

/**
 * Trustworthy per-option stock for a variation listing comes from the Inventory API
 * (`inventory_item.availability.shipToLocationAvailability.quantity`), NOT GetItem's
 * per-option Quantity (which lags/degrades after INW publishes a variation group).
 *
 * Reads each INW variant SKU's live available quantity and applies it onto INW's matrix.
 * Rows with no SKU or no successful read keep their existing INW quantity, so a failed
 * read can never zero stock. Returns null when nothing readable was found.
 */
export async function pullEbayVariantQuantitiesFromInventory(
  accessToken: string,
  variants: unknown
): Promise<VariantMatrix | null> {
  const matrix = normalizeVariantMatrix(variants);
  if (!matrix || matrix.skus.length === 0) return null;
  const rows = matrix.skus.filter((row) => row.sku?.trim());
  if (rows.length === 0) return null;

  const live: LiveVariantQuantity[] = [];
  await forEachInChunks(rows, EBAY_INVENTORY_READ_CONCURRENCY, async (row) => {
    const sku = row.sku!.trim();
    const liveItem = await fetchLiveInventoryItem(accessToken, sku);
    const qty = readLiveInventoryAvailableQuantity(liveItem);
    if (qty != null) live.push({ sku, options: row.options, quantity: qty });
  });
  if (live.length === 0) return null;
  return applyLiveInventoryQuantitiesToMatrix(matrix, live);
}

/** GetItem listing Quantity is not per-option stock. Do not copy it onto variation listings. */
export function ebayGetItemShouldApplyListingQuantity(args: {
  localHasOptionQuantities: boolean;
  applyRemoteVariants: boolean;
}): boolean {
  if (args.localHasOptionQuantities && !args.applyRemoteVariants) return false;
  return true;
}

export function isEbayInboundContentChange(updateData: Record<string, unknown>): boolean {
  return Object.keys(updateData).some((key) => !EBAY_INBOUND_META_KEYS.has(key));
}

/**
 * GetItem can lag Inventory PUT by minutes. lastSynced is only the title GetItem
 * last confirmed — not the title we just PUT — so a lagged replica still equals
 * lastSynced and is not treated as a seller revise.
 */

/** Stamps lastInboundAt so preserve / outbound inw>inbound / retry-drop keep working. */
export function ebayGetItemContentApplyLinkData(args: {
  contentHash: string;
  metaHash: string;
  variantsHash: string;
  quantity: number;
  remoteUpdatedAt: Date | null;
  conflictDetails: unknown;
  remoteTitle: string;
  now?: Date;
  /** False when we kept the INW title (lagged GetItem / qty-only apply). */
  titleApplied?: boolean;
  /** Per-SKU prices just applied from GetItem — stop outbound treating them as an INW price edit. */
  variantPricesHash?: string | null;
}) {
  const now = args.now ?? new Date();
  const pendingCleared = withEbayPendingInbound(args.conflictDetails, null);
  const titled =
    args.titleApplied === false
      ? pendingCleared
      : withEbayLastSyncedTitle(pendingCleared, args.remoteTitle);
  const conflictDetails = args.variantPricesHash
    ? withLastPushedVariantPricesHash(titled, args.variantPricesHash)
    : titled;
  return {
    syncBaselineHash: args.contentHash,
    syncBaselineMetaHash: args.metaHash,
    syncBaselineVariantsHash: args.variantsHash,
    syncBaselineQty: args.quantity,
    syncBaselineAt: args.remoteUpdatedAt ?? now,
    lastInboundAt: now,
    syncStatus: "synced" as const,
    syncError: null,
    conflictDetails: conflictDetails as Prisma.InputJsonValue,
  };
}

function ebayInboundLooksLikeIndependentRevise(args: {
  inwTitle: string;
  remoteTitle: string | null | undefined;
  lastSyncedTitle: string | null | undefined;
  lastPushedAt?: Date | null;
  now?: Date;
}): boolean {
  return ebayRemoteLooksLikeIndependentRevise(args);
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

/**
 * GetItem almost never includes LastModifiedTime. After an INW title save, eBay can
 * still show the previous title (push echo, or a #25014 picture mix that blocked the PUT).
 * Cron-dirty / confirmed-snapshot must not copy that lagged title back onto INW once
 * we have successfully pulled at least once. A listing that has never pulled
 * (`lastInboundAt` null, including INW-created publishes) must still adopt a
 * real field diff — echo is handled separately by `ebayGetItemIsPushEcho`.
 * `lastPushedAt` is accepted for call-site symmetry; it is not used here.
 */
export function ebayGetItemShouldPreserveInwContent(args: {
  inwUpdatedAt: Date | null;
  lastInboundAt: Date | null;
  lastPushedAt?: Date | null;
  ebayLastModified?: Date | null;
}): boolean {
  const ebayAt = args.ebayLastModified?.getTime() ?? 0;
  const inwAt = args.inwUpdatedAt?.getTime() ?? 0;
  if (ebayAt > 0 && (inwAt === 0 || ebayAt > inwAt)) return false;
  const inboundAt = args.lastInboundAt?.getTime() ?? 0;
  // Never successfully pulled from eBay. Missing LastModifiedTime must not hide a
  // seller revise (INW-created listings stay lastInboundAt=null after publish).
  if (inboundAt === 0) return false;
  return inwAt > inboundAt;
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

/**
 * Per-variation two-look/settle guard. GetItem StartPrice + Inventory API per-SKU stock can lag
 * right after INW pushed a variation edit, so a rotate snapshot must not immediately revert a
 * just-applied per-SKU qty/price. Dirty seller-list / webhook rows already have a second signal
 * (title/price/qty moved on GetMyeBaySelling, or a platform ping) — holding those dropped
 * eBay SKU-price edits after the listing title had already been applied.
 */
export { readEbayPendingVariantInboundHash };

export function withEbayPendingVariantInbound(
  conflictDetails: unknown,
  pending: EbayPendingInbound | null
): Prisma.InputJsonValue {
  const base =
    conflictDetails && typeof conflictDetails === "object" && !Array.isArray(conflictDetails)
      ? { ...(conflictDetails as Record<string, unknown>) }
      : {};
  if (pending) {
    base.ebayPendingVariantInbound = pending;
  } else {
    delete base.ebayPendingVariantInbound;
  }
  return base as Prisma.InputJsonValue;
}

/** Hold a variant overlay only on the untrusted rotate path, and only until a matching second look. */
export function shouldHoldEbayVariantInbound(args: {
  matrixChanged: boolean;
  inSettleWindow: boolean;
  source?: EbayGetItemApplySource;
  pendingVariantHash: string | null;
  variantSnapshotHash: string | null;
}): boolean {
  if (!args.matrixChanged || !args.inSettleWindow) return false;
  if (ebayApplyTrustsSingleSnapshot(args.source)) return false;
  if (args.variantSnapshotHash == null) return false;
  return args.pendingVariantHash !== args.variantSnapshotHash;
}

/**
 * Dirty-list gap guard.
 *
 * GetMyeBaySelling is only a dirty detector: when it shows a row's title/price/qty differs
 * from INW we do a live GetItem to learn the truth. If that GetItem is inconclusive (unusable
 * details — eBay lag, partial response, transient error), we do NOT know who is newer. Pushing
 * INW→eBay outbound in that window would clobber a real seller eBay edit we simply failed to
 * read. So we stamp the link and refuse outbound until a *conclusive* GetItem resolves the row.
 *
 * The marker is set on an inconclusive cron-dirty GetItem and cleared the moment any conclusive
 * GetItem (dirty, rotate, or webhook) resolves the row. A TTL is a safety net so a permanently
 * unreadable listing cannot strand outbound forever.
 */
export const EBAY_DIRTY_UNCONFIRMED_TTL_MS = 20 * 60_000;

export function readEbayDirtyUnconfirmedAt(conflictDetails: unknown): Date | null {
  if (!conflictDetails || typeof conflictDetails !== "object" || Array.isArray(conflictDetails)) {
    return null;
  }
  const raw = (conflictDetails as { ebayDirtyUnconfirmedAt?: unknown }).ebayDirtyUnconfirmedAt;
  if (typeof raw !== "string" || !raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ebayDirtyInboundUnconfirmed(conflictDetails: unknown, now: Date = new Date()): boolean {
  const at = readEbayDirtyUnconfirmedAt(conflictDetails);
  if (!at) return false;
  return now.getTime() - at.getTime() < EBAY_DIRTY_UNCONFIRMED_TTL_MS;
}

export function withEbayDirtyUnconfirmed(
  conflictDetails: unknown,
  at: Date | null
): Prisma.InputJsonValue {
  const base =
    conflictDetails && typeof conflictDetails === "object" && !Array.isArray(conflictDetails)
      ? { ...(conflictDetails as Record<string, unknown>) }
      : {};
  if (at) {
    base.ebayDirtyUnconfirmedAt = at.toISOString();
  } else {
    delete base.ebayDirtyUnconfirmedAt;
  }
  return base as Prisma.InputJsonValue;
}

/**
 * Post-inbound settle window.
 *
 * eBay's GetItem (used on the cron *rotate* path) frequently lags a revise by several
 * minutes and can return the PRE-edit snapshot right after we already applied a seller
 * edit inbound (webhook / dirty pull). Without a strictly-newer LastModifiedTime that
 * lagged snapshot looks like an "independent revise" and would snap the just-applied
 * title/qty back to the old value (the reported eBay snap-back). Within this window, a
 * rotate revise that is not proven newer must be confirmed by a second consistent look
 * (pending → confirmed-snapshot) before we apply it. Dirty/webhook single-snapshot trust
 * is unaffected — this only guards the two-look rotate path.
 */
export const EBAY_POST_INBOUND_SETTLE_MS = 10 * 60_000;

export function ebayInPostInboundSettleWindow(args: {
  lastInboundAt: Date | null;
  now?: Date;
}): boolean {
  if (!args.lastInboundAt) return false;
  const now = (args.now ?? new Date()).getTime();
  return now - args.lastInboundAt.getTime() < EBAY_POST_INBOUND_SETTLE_MS;
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
 * Dirty/webhook GetItem carries per-variation Quantity from Trading. Overlay it even when
 * the listing-level total still matches INW (a single SKU edit often leaves Quantity unchanged).
 * Rotate still uses the Inventory API only when the listing total diverges — GetItem lag there
 * is untrusted, and Inventory-API all-1s must not wipe INW.
 */
export function shouldOverlayEbayGetItemSkuQuantities(args: {
  skipQuantity?: boolean;
  source?: EbayGetItemApplySource;
  inwMatrix: VariantMatrix | null;
  remoteMatrix: VariantMatrix | null;
}): boolean {
  if (args.skipQuantity) return false;
  if (!ebayApplyTrustsSingleSnapshot(args.source)) return false;
  if (!args.inwMatrix || !args.remoteMatrix) return false;
  if (remoteVariantMatrixIsWeaker(args.inwMatrix, args.remoteMatrix)) return false;
  if (variantQuantitiesLookDegraded(args.inwMatrix, args.remoteMatrix)) return false;
  return (
    variantsStructureQtyFingerprint(args.inwMatrix) !==
    variantsStructureQtyFingerprint(args.remoteMatrix)
  );
}

/**
 * GetItem often omits LastModifiedTime (only StartTime/EndTime). Cron rotate confirms a
 * new snapshot on two consecutive looks when LastModified is missing. A verified
 * Platform Notification or a dirty GetMyeBaySelling row skips await-confirm but still
 * ignores our own push echo. Description-only revises apply on the first look — rotate
 * used to skip them as matches-inw, then outbound wrote the old INW body back to eBay.
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
  lastSyncedTitle?: string | null;
  source?: EbayGetItemApplySource;
  now?: Date;
  inwVariantPricesHash?: string | null;
  remoteVariantPricesHash?: string | null;
  lastPushedVariantPricesHash?: string | null;
  /** Held per-SKU snapshot from a prior GetItem; listing title/qty may already match INW. */
  pendingVariantInboundHash?: string | null;
  inwVariantQtyHash?: string | null;
  remoteVariantQtyHash?: string | null;
  remoteVariantQtyLooksDegraded?: boolean;
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
  const preserveInwContent = ebayGetItemShouldPreserveInwContent(args);
  const independentRevise = ebayInboundLooksLikeIndependentRevise({
    inwTitle: args.inwTitle,
    remoteTitle: args.remoteTitle,
    lastSyncedTitle: args.lastSyncedTitle,
    lastPushedAt: args.lastPushedAt,
    now: args.now,
  });
  const qtyPriceMatch =
    args.remotePriceCents === args.inwPriceCents && args.remoteQuantity === args.inwQuantity;
  const variantPricesDiffer =
    Boolean(args.remoteVariantPricesHash) &&
    args.remoteVariantPricesHash !== (args.inwVariantPricesHash ?? "");
  const hubSkuPricesMatchLastPush =
    Boolean(args.inwVariantPricesHash) &&
    args.inwVariantPricesHash === (args.lastPushedVariantPricesHash ?? "");
  const independentSkuPriceRevise =
    variantPricesDiffer &&
    (!hubSkuPricesMatchLastPush ||
      (args.ebayLastModified != null &&
        args.lastPushedAt != null &&
        args.ebayLastModified.getTime() > args.lastPushedAt.getTime() + SYNC_ECHO_SKEW_MS));
  const independentSkuQtyRevise =
    Boolean(args.remoteVariantQtyHash) &&
    args.remoteVariantQtyHash !== (args.inwVariantQtyHash ?? "") &&
    !args.remoteVariantQtyLooksDegraded;
  const listingFieldsMatch =
    remoteHash === inwHash &&
    !descriptionDiffers &&
    !independentSkuPriceRevise &&
    !independentSkuQtyRevise;
  // SKU-price diffs must not disable this skip. Listing CurrentPrice is the cheapest
  // variation, so a hub SKU edit looks like "eBay differs" while eBay is still older.
  const inwLooksNewer =
    preserveInwContent && qtyPriceMatch && !independentRevise && !descriptionDiffers;

  // Title can already match INW (applied on the first look) while per-SKU prices are still
  // held. Without this, matches-inw aborts before the variant overlay and the $20 never lands.
  if (args.pendingVariantInboundHash) {
    if (ebayGetItemIsPushEcho(args)) {
      return { action: "skip", reason: "echo-of-push" };
    }
    return {
      action: "apply",
      reason: "pending-variant-confirm",
      pendingHash: remoteHash,
    };
  }

  // Verified ping or dirty seller-list row: apply a real field diff unless this is our push echo.
  if (ebayApplyTrustsSingleSnapshot(args.source)) {
    if (listingFieldsMatch) {
      return { action: "skip", reason: "matches-inw" };
    }
    if (ebayGetItemIsPushEcho(args)) {
      return { action: "skip", reason: "echo-of-push" };
    }
    // Listing total often stays put on a single-SKU qty edit. After an INW save,
    // inwLooksNewer would skip that webhook and leave Inventory API on the old qty,
    // which Seller Hub immediately redisplays.
    if (inwLooksNewer && !independentSkuQtyRevise) {
      return { action: "skip", reason: "inw-newer-than-ebay" };
    }
    return {
      action: "apply",
      reason: args.source === "cron-dirty" ? "dirty-revise" : "webhook-revise",
      pendingHash: remoteHash,
    };
  }

  if (args.ebayLastModified != null && !ebayGetItemIsStaleVersusInw(args)) {
    if (listingFieldsMatch) {
      return { action: "skip", reason: "matches-inw" };
    }
    if (ebayGetItemIsPushEcho(args)) {
      return { action: "skip", reason: "echo-of-push" };
    }
    if (inwLooksNewer) {
      return { action: "skip", reason: "inw-newer-than-ebay" };
    }
    return { action: "apply", reason: "lastModified-newer" };
  }

  if (inboundAt == null && pushedAt == null) {
    return { action: "apply", reason: "first-pull" };
  }

  if (listingFieldsMatch) {
    return { action: "skip", reason: "matches-inw" };
  }

  // Right after we pushed, GetItem may still show the previous listing.
  if (ebayGetItemIsPushEcho(args)) {
    return { action: "skip", reason: "echo-of-push" };
  }

  if (inwLooksNewer) {
    return { action: "skip", reason: "inw-newer-than-ebay" };
  }

  // Stale LastModified with a lagged title (qty/desc unchanged) is old news.
  if (
    args.ebayLastModified != null &&
    ebayGetItemIsStaleVersusInw(args) &&
    qtyPriceMatch &&
    !descriptionDiffers &&
    !independentSkuPriceRevise &&
    !independentSkuQtyRevise &&
    !independentRevise
  ) {
    return { action: "skip", reason: "lastModified-not-newer" };
  }

  if (independentRevise) {
    // Reaching here means eBay is NOT proven newer (no strictly-newer LastModifiedTime —
    // that case already returned "lastModified-newer" above). If we just applied an inbound
    // edit, a lagged rotate GetItem could be showing the pre-edit snapshot; require a second
    // consistent look before reverting a just-applied value.
    if (
      ebayInPostInboundSettleWindow({ lastInboundAt: args.lastInboundAt, now: args.now }) &&
      args.pendingRemoteHash !== remoteHash
    ) {
      return { action: "pending", reason: "settle-await-confirm", pendingHash: remoteHash };
    }
    return { action: "apply", reason: "remote-revise", pendingHash: remoteHash };
  }

  if (descriptionDiffers && qtyPriceMatch) {
    if (
      ebayInPostInboundSettleWindow({ lastInboundAt: args.lastInboundAt, now: args.now }) &&
      args.pendingRemoteHash !== remoteHash
    ) {
      return { action: "pending", reason: "settle-await-confirm", pendingHash: remoteHash };
    }
    return { action: "apply", reason: "remote-revise", pendingHash: remoteHash };
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
      source: opts?.source,
    });
    // A dirty-list row we could not read conclusively: block outbound so we don't clobber a
    // real seller eBay edit we simply failed to fetch. Cleared on the next conclusive GetItem.
    if (opts?.source === "cron-dirty" && !readEbayDirtyUnconfirmedAt(link.conflictDetails)) {
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { conflictDetails: withEbayDirtyUnconfirmed(link.conflictDetails, new Date()) },
        })
        .catch(() => {});
    }
    return {
      storeItemId: storeItem.id,
      title: storeItem.title,
      updated: false,
      changes: [],
    };
  }
  // Conclusive GetItem: we now have ground truth, so lift any dirty-unconfirmed outbound block.
  if (readEbayDirtyUnconfirmedAt(link.conflictDetails)) {
    const cleared = withEbayDirtyUnconfirmed(link.conflictDetails, null);
    await prisma.channelListingLink
      .update({ where: { id: link.id }, data: { conflictDetails: cleared } })
      .catch(() => {});
    link.conflictDetails = cleared as typeof link.conflictDetails;
  }
  const lastSyncedTitle = readEbayLastSyncedTitle(link.conflictDetails);
  const independentRevise = ebayInboundLooksLikeIndependentRevise({
    inwTitle: storeItem.title,
    remoteTitle: details.title,
    lastSyncedTitle,
    lastPushedAt: link.lastPushedAt,
  });
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
    lastSyncedTitle,
    source: opts?.source,
    inwVariantPricesHash: variantPricesFingerprint(storeItem.variants) || null,
    remoteVariantPricesHash: matrixHasKnownSkuPrices(details.variants)
      ? variantPricesFingerprint(details.variants)
      : null,
    lastPushedVariantPricesHash: readLastPushedVariantPricesHash(link.conflictDetails),
    pendingVariantInboundHash: readEbayPendingVariantInboundHash(link.conflictDetails),
    inwVariantQtyHash: variantsStructureQtyFingerprint(storeItem.variants) || null,
    remoteVariantQtyHash: variantsStructureQtyFingerprint(details.variants) || null,
    remoteVariantQtyLooksDegraded: variantQuantitiesLookDegraded(
      storeItem.variants,
      details.variants
    ),
  });
  const preserveInwContent =
    !independentRevise &&
    ebayGetItemShouldPreserveInwContent({
      lastInboundAt: link.lastInboundAt,
      lastPushedAt: link.lastPushedAt,
      inwUpdatedAt: storeItem.updatedAt,
      ebayLastModified: details.remoteUpdatedAt,
    });

  const endedDecision = ebayGetItemEndedDecision({
    listingEnded: details.listingEnded,
    quantity: details.quantity,
    inwUpdatedAt: storeItem.updatedAt,
    lastPushedAt: link.lastPushedAt,
  });

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

  let liveQtyCatchUp: EbayLiveQtyCatchUp | null = null;
  if (!opts?.skipQuantity && hasOptionQuantities(storeItem.variants)) {
    const catchUpMatrix = normalizeVariantMatrix(storeItem.variants);
    if (catchUpMatrix) {
      try {
        liveQtyCatchUp = await catchUpEbayLiveVariantQuantities({
          accessToken,
          inwMatrix: catchUpMatrix,
          tradingMatrix: normalizeVariantMatrix(details.variants),
          retryIfUnchangedMs: opts?.source === "webhook" ? 2500 : 0,
        });
      } catch (e) {
        console.warn("[ebay] live listing qty catch-up failed", {
          storeItemId: storeItem.id,
          legacyItemId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

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

  const forceQtyFromLiveCatchUp = Boolean(liveQtyCatchUp?.inwNeedsUpdate);
  if (!opts?.force && applyDecision.action !== "apply" && !forceQtyFromLiveCatchUp) {
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
    } else if (applyDecision.reason === "matches-inw") {
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: {
            conflictDetails: withEbayLastSyncedTitle(
              withEbayPendingInbound(conflictDetails, null),
              details.title ?? storeItem.title
            ) as Prisma.InputJsonValue,
          },
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
  let pulledEbayVariantQty = false;
  const skipContent = opts?.skipContent === true;
  const skipLaggedTitle = skipContent || preserveInwContent;
  const remoteTitleMatchesInw = remoteTitle === storeItem.title;

  if (preserveInwContent && opts?.skipContent !== true) {
    console.log("[ebay] refreshEbayListingByItemId: keep INW title; still apply qty/description diffs", {
      storeItemId: storeItem.id,
      legacyItemId,
      source: opts?.source ?? "cron",
      inwTitle: storeItem.title,
      getItemTitle: details.title,
      inwUpdatedAt: storeItem.updatedAt.toISOString(),
      lastInboundAt: link.lastInboundAt?.toISOString() ?? null,
      ebayLastModified: details.remoteUpdatedAt?.toISOString() ?? null,
    });
  }

  if (!skipLaggedTitle && remoteTitle && remoteTitle !== storeItem.title) {
    updateData.title = remoteTitle;
    changes.push("title");
  }

  if (!skipLaggedTitle && details.condition && details.condition !== storeItem.condition) {
    updateData.condition = details.condition;
    changes.push(`condition (${details.condition})`);
  }

  if (!skipLaggedTitle && details.conditionEnum && details.conditionEnum !== storeItem.ebayConditionEnum) {
    updateData.ebayConditionEnum = details.conditionEnum;
    changes.push(`ebay condition (${details.conditionEnum})`);
  }

  if (
    !skipLaggedTitle &&
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
    !skipLaggedTitle &&
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

  if (
    !skipContent &&
    description &&
    description !== storeItem.description &&
    (!skipLaggedTitle || remoteTitleMatchesInw)
  ) {
    updateData.description = description;
    changes.push("description");
  }

  const remoteVariantMatrix = normalizeVariantMatrix(details.variants);

  const applyRemoteVariants = shouldApplyEbayInboundVariants({
    localVariants: storeItem.variants,
    remoteVariants: details.variants,
  });

  // A per-option variation listing prices each SKU independently. eBay's listing-level
  // CurrentPrice is the *lowest* variation price, so applying it standalone would collapse
  // every INW variation to that price. Per-SKU prices are pulled below instead.
  const inwIsPerOption = hasOptionQuantities(storeItem.variants) && !applyRemoteVariants;

  if (!skipContent && !inwIsPerOption && remotePrice !== storeItem.priceCents) {
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

  if (
    !opts?.skipQuantity &&
    remoteQty !== storeItem.quantity &&
    ebayGetItemShouldApplyListingQuantity({
      localHasOptionQuantities: hasOptionQuantities(storeItem.variants),
      applyRemoteVariants,
    })
  ) {
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
  } else if (inwIsPerOption) {
    // Per-option variation listing. GetItem's listing-level qty/price are aggregates
    // (summed/degraded qty, lowest variation price), so pull per-SKU stock from
    // GetItem Variation.Quantity on dirty/webhook (even when the listing total still
    // matches INW) and per-SKU prices from StartPrice. Rotate still falls back to the
    // Inventory API only when the listing total diverges.
    const inwMatrix = normalizeVariantMatrix(storeItem.variants);
    const remotePrices: RemoteVariantPrice[] =
      remoteVariantMatrix?.skus
        .filter((s) => s.priceCents != null && s.priceCents > 0)
        .map((s) => ({
          sku: s.sku ?? null,
          options: s.options,
          priceCents: s.priceCents as number,
        })) ?? [];

    const qtyDiverged = !opts?.skipQuantity && remoteQty !== storeItem.quantity;
    const overlayGetItemSkuQty = shouldOverlayEbayGetItemSkuQuantities({
      skipQuantity: opts?.skipQuantity,
      source: opts?.source,
      inwMatrix,
      remoteMatrix: remoteVariantMatrix,
    });
    let workingMatrix: VariantMatrix | null = inwMatrix;
    let qtyPulled = false;
    if (liveQtyCatchUp && liveQtyCatchUp.quantities.length > 0 && inwMatrix) {
      workingMatrix = applyLiveInventoryQuantitiesToMatrix(inwMatrix, liveQtyCatchUp.quantities);
      qtyPulled = liveQtyCatchUp.inwNeedsUpdate;
    } else if (overlayGetItemSkuQty && inwMatrix && remoteVariantMatrix) {
      // Seller Hub qty lives on Trading/GetItem. The Inventory API still holds the last
      // INW push, so reading it here ignores the seller edit and later outbound snaps eBay.
      workingMatrix = applyLiveInventoryQuantitiesToMatrix(
        inwMatrix,
        remoteVariantMatrix.skus.map((s) => ({
          sku: s.sku ?? null,
          options: s.options,
          quantity: s.quantity,
        }))
      );
      qtyPulled = true;
    } else if (qtyDiverged && inwMatrix) {
      const inventoryMatrix = await pullEbayVariantQuantitiesFromInventory(
        accessToken,
        storeItem.variants
      );
      if (inventoryMatrix) {
        workingMatrix = inventoryMatrix;
        qtyPulled = true;
      } else {
        console.warn("[ebay] skip GetItem listing qty; no readable inventory variant stock", {
          storeItemId: storeItem.id,
          legacyItemId,
          remoteQty,
          inwQuantity: storeItem.quantity,
        });
      }
    }

    if (workingMatrix && remotePrices.length > 0) {
      workingMatrix = applyRemoteVariantPricesToMatrix(workingMatrix, remotePrices, {
        listingMinCents: Math.min(
          remotePrice,
          ...remotePrices.map((p) => p.priceCents)
        ),
        inwListingPriceCents: storeItem.priceCents,
      });
    }

    const currentSerialized = inwMatrix ? serializeVariantMatrix(inwMatrix) : null;
    const nextSerialized = workingMatrix ? serializeVariantMatrix(workingMatrix) : null;
    const matrixChanged =
      JSON.stringify(nextSerialized) !== JSON.stringify(currentSerialized);
    const sum = workingMatrix ? sumMatrixQuantities(workingMatrix) : storeItem.quantity;
    const nextListingPrice = workingMatrix
      ? inboundListingPriceCents(workingMatrix, storeItem.priceCents)
      : storeItem.priceCents;
    const unsoldZero =
      qtyPulled &&
      ebayGetItemQtyIsUnsoldZero({
        listingEnded: details.listingEnded,
        quantitySold: details.quantitySold,
        quantity: sum,
      });

    console.log("[ebay] variation price/qty inbound decision", {
      storeItemId: storeItem.id,
      legacyItemId,
      remoteListingPrice: remotePrice,
      remotePerSkuPriceCount: remotePrices.length,
      inwHadPerSkuPrices: Boolean(inwMatrix?.skus.some((s) => s.priceCents != null && s.priceCents > 0)),
      qtyDiverged,
      overlayGetItemSkuQty,
      qtyPulled,
      matrixChanged,
      sum,
      nextListingPrice,
      inwListingPrice: storeItem.priceCents,
      unsoldZero,
    });

    // Two-look/settle guard: a lagged Inventory/GetItem read right after INW pushed (or applied)
    // a variation edit could show the pre-edit per-SKU values and revert them. Within the settle
    // window (keyed off the most recent INW-side touch), require a second consistent look before
    // applying a variation change.
    const variantSnapshotHash = nextSerialized ? variantsFingerprint(nextSerialized) : null;
    const lastInwTouch =
      [link.lastPushedAt, link.lastInboundAt]
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const inVariantSettle = ebayInPostInboundSettleWindow({ lastInboundAt: lastInwTouch });
    const pendingVariantHash = readEbayPendingVariantInboundHash(conflictDetails);
    const holdVariantForSettle = shouldHoldEbayVariantInbound({
      matrixChanged,
      inSettleWindow: inVariantSettle,
      source: opts?.source,
      pendingVariantHash,
      variantSnapshotHash,
    });

    const inwSkus = inwMatrix?.skus ?? [];
    const remotePriceByKey = new Map(
      remotePrices.map((r) => [optionValuesKey(r.options ?? {}) || (r.sku ?? ""), r.priceCents])
    );
    recordVariantPriceTrace({
      memberId: storeItem.memberId,
      provider: "ebay",
      storeItemId: storeItem.id,
      direction: "reconcile",
      decision: unsoldZero
        ? "var:skip-unsold-zero"
        : holdVariantForSettle
          ? "var:hold-settle"
          : matrixChanged
            ? "var:pull"
            : "var:unchanged",
      note: holdVariantForSettle ? "awaiting second consistent look" : undefined,
      rows: buildIntendedVariantPriceRows(inwSkus, optionValuesKey, remotePriceByKey),
    });

    if (unsoldZero) {
      console.warn("[ebay] skip inventory variant qty 0 on an active listing with no QuantitySold", {
        storeItemId: storeItem.id,
        legacyItemId,
        sum,
        quantitySold: details.quantitySold,
      });
    } else if (holdVariantForSettle) {
      console.warn("[ebay] hold variation inbound; awaiting second consistent look (settle)", {
        storeItemId: storeItem.id,
        legacyItemId,
        variantSnapshotHash,
        lastInwTouch: lastInwTouch?.toISOString() ?? null,
      });
      conflictDetails = withEbayPendingVariantInbound(conflictDetails, {
        hash: variantSnapshotHash as string,
        seenAt: new Date().toISOString(),
      });
      await prisma.channelListingLink
        .update({
          where: { id: link.id },
          data: { conflictDetails: conflictDetails as Prisma.InputJsonValue },
        })
        .catch(() => {});
    } else if (workingMatrix && nextSerialized && matrixChanged) {
      updateData.variants = nextSerialized;
      if (qtyPulled && sum !== storeItem.quantity) {
        updateData.quantity = sum;
        updateData.status = sum > 0 ? "active" : "sold_out";
      }
      if (nextListingPrice > 0 && nextListingPrice !== storeItem.priceCents) {
        updateData.priceCents = nextListingPrice;
      }
      changes.push("variant prices/quantities");
      if (
        qtyPulled &&
        inwMatrix &&
        variantsStructureQtyFingerprint(inwMatrix) !== variantsStructureQtyFingerprint(workingMatrix)
      ) {
        pulledEbayVariantQty = !liveQtyCatchUp?.wroteOffers;
      }
      // A confirmed snapshot was applied — clear any pending variation snapshot.
      conflictDetails = withEbayPendingVariantInbound(conflictDetails, null);
    }
  }

  if (!skipLaggedTitle && applyRemoteVariants && remoteVariantMatrix && remoteVariantMatrix.skus.length > 0) {
    updateData.variants = serializeVariantMatrix(remoteVariantMatrix);
    const sum = sumMatrixQuantities(remoteVariantMatrix);
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

  if (!skipLaggedTitle && resolvedCat) {
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

  if (!skipLaggedTitle && details.remoteCategoryId) {
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
    const titleApplied = typeof updateData.title === "string";
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
        data: ebayGetItemContentApplyLinkData({
          contentHash,
          metaHash,
          variantsHash: variantsFingerprint(updatedItem.variants),
          quantity: updatedItem.quantity,
          remoteUpdatedAt: details.remoteUpdatedAt ?? null,
          conflictDetails,
          remoteTitle,
          titleApplied,
          variantPricesHash: updateData.variants
            ? variantPricesFingerprint(updatedItem.variants)
            : null,
        }),
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
      await updateStoreItemOnChannels(storeItem.id, {
        skipProviders: ["ebay"],
        sourceUpdatedAt: details.remoteUpdatedAt ?? undefined,
      });
    }
    // Trading/GetItem qty is what the seller edited. eBay Inventory API still holds the
    // last INW push, and Seller Hub will snap Trading back to it unless we catch Inventory up.
    if (pulledEbayVariantQty) {
      await syncInventoryToChannels(storeItem.id, {
        skipProviders: ["etsy", "wix", "shopify"],
        force: true,
      });
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
          updatedAt: true,
        },
      },
    },
  });
  if (!link?.storeItem) return null;

  const preserveInwContent = ebayGetItemShouldPreserveInwContent({
    inwUpdatedAt: link.storeItem.updatedAt,
    lastInboundAt: link.lastInboundAt,
    lastPushedAt: link.lastPushedAt,
    ebayLastModified: args.postcard.lastModified ?? null,
  });

  const updateData: Record<string, unknown> = {};
  const changes: string[] = [];
  if (writes.title && writes.title !== link.storeItem.title && !preserveInwContent) {
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
  if (!preserveInwContent) {
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
        conflictDetails: withEbayLastSyncedTitle(
          link.conflictDetails,
          typeof writes.title === "string" ? writes.title : updatedItem.title
        ) as Prisma.InputJsonValue,
      },
    });
  }
  console.log("[ebay] xml postcard", {
    storeItemId: updatedItem.id,
    itemId: args.itemId,
    changes,
  });
  await updateStoreItemOnChannels(updatedItem.id, {
    skipProviders: ["ebay"],
    sourceUpdatedAt: args.postcard.lastModified ?? undefined,
  });
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

/** GetItem only accepts numeric eBay Item IDs, never Inventory/variation SKUs. */
export function ebayItemIdForGetItem(args: {
  externalListingId: string;
  sellerListListingId?: string | null;
}): string | null {
  return (
    resolveEbayLegacyListingId(args.externalListingId) ??
    (args.sellerListListingId
      ? resolveEbayLegacyListingId(args.sellerListListingId)
      : null)
  );
}

function matchEbaySellerListRow(
  link: { externalListingId: string; storeItem?: { id?: string } | null },
  byRemote: Map<string, EbayTradingListing>
): EbayTradingListing | undefined {
  const keys = [
    link.externalListingId,
    resolveEbayLegacyListingId(link.externalListingId) ?? undefined,
    link.storeItem?.id,
  ].filter((key): key is string => Boolean(key));
  for (const key of keys) {
    const hit = byRemote.get(key);
    if (hit) return hit;
  }
  return undefined;
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
      conflictDetails: true,
      storeItem: { select: { id: true, title: true, priceCents: true, quantity: true } },
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
      if (readEbayPendingVariantInboundHash(link.conflictDetails)) {
        dirty.push(link);
        continue;
      }
      const remote = matchEbaySellerListRow(link, byRemote);
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
      const remote = matchEbaySellerListRow(link, byRemote);
      const legacyId = ebayItemIdForGetItem({
        externalListingId: link.externalListingId,
        sellerListListingId: remote?.listingId,
      });
      if (!legacyId) continue;
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
      const remote = matchEbaySellerListRow(link, byRemote);
      const legacyId = ebayItemIdForGetItem({
        externalListingId: link.externalListingId,
        sellerListListingId: remote?.listingId,
      });
      if (!legacyId) continue;
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

/** Failed INW→eBay content pushes are not recovered by GetItem pull. Retry a few each cron. */
export const EBAY_CRON_FAILED_OUTBOUND_LIMIT = 8;

export function ebayCronShouldRetryOutbound(args: {
  syncEnabled: boolean;
  syncStatus: string;
  ended: boolean;
}): boolean {
  return args.syncEnabled && !args.ended && args.syncStatus === "error";
}

/**
 * Save-time INW→eBay is the primary push. Cron also retries failed writes and
 * listings the seller saved on INW after the last eBay push/pull (skipped or
 * silently dropped at save time). Do not re-push a GetItem inbound echo.
 */
export function ebayCronShouldPushOutbound(args: {
  syncEnabled: boolean;
  syncStatus: string;
  ended: boolean;
  inwUpdatedAt: Date | null;
  lastPushedAt: Date | null;
  lastInboundAt: Date | null;
  /** eBay diverged (dirty) but the live GetItem was inconclusive — do not clobber it. */
  dirtyInboundUnconfirmed?: boolean;
  /** Per-SKU GetItem snapshot is held; pushing qty would snap the seller's eBay edit. */
  pendingVariantInbound?: boolean;
}): boolean {
  if (!args.syncEnabled || args.ended) return false;
  // A dirty eBay row we could not read conclusively wins over an automatic INW re-push.
  if (args.dirtyInboundUnconfirmed) return false;
  if (args.pendingVariantInbound) return false;
  if (args.syncStatus === "error") return true;
  if (!args.inwUpdatedAt) return false;
  const inw = args.inwUpdatedAt.getTime();
  const pushed = args.lastPushedAt?.getTime() ?? 0;
  const inbound = args.lastInboundAt?.getTime() ?? 0;
  return inw > pushed && inw > inbound;
}

/**
 * GetItem pull never writes INW edits to eBay. Retry failed save-time pushes
 * and INW-newer live listings on the 5-minute cron.
 */
export async function pushFailedEbayOutboundForConnection(
  connectionId: string
): Promise<{ attempted: number; storeItemIds: string[] }> {
  const [errored, recent] = await Promise.all([
    prisma.channelListingLink.findMany({
      where: {
        connectionId,
        provider: "ebay",
        syncEnabled: true,
        syncStatus: "error",
      },
      orderBy: { updatedAt: "desc" },
      take: EBAY_CRON_FAILED_OUTBOUND_LIMIT,
      select: {
        storeItemId: true,
        conflictDetails: true,
        syncError: true,
        syncStatus: true,
        lastPushedAt: true,
        lastInboundAt: true,
        storeItem: { select: { updatedAt: true } },
      },
    }),
    prisma.channelListingLink.findMany({
      where: {
        connectionId,
        provider: "ebay",
        syncEnabled: true,
      },
      orderBy: { storeItem: { updatedAt: "desc" } },
      take: EBAY_CRON_FAILED_OUTBOUND_LIMIT * 3,
      select: {
        storeItemId: true,
        conflictDetails: true,
        syncError: true,
        syncStatus: true,
        lastPushedAt: true,
        lastInboundAt: true,
        storeItem: { select: { updatedAt: true } },
      },
    }),
  ]);
  const seen = new Set<string>();
  const links = [...errored, ...recent].filter((link) => {
    if (seen.has(link.storeItemId)) return false;
    seen.add(link.storeItemId);
    return ebayCronShouldPushOutbound({
      syncEnabled: true,
      syncStatus: link.syncStatus,
      ended: shouldSkipEndedEbayOutbound("ebay", link.conflictDetails),
      inwUpdatedAt: link.storeItem.updatedAt,
      lastPushedAt: link.lastPushedAt,
      lastInboundAt: link.lastInboundAt,
      dirtyInboundUnconfirmed: ebayDirtyInboundUnconfirmed(link.conflictDetails),
      pendingVariantInbound: Boolean(readEbayPendingVariantInboundHash(link.conflictDetails)),
    });
  }).slice(0, EBAY_CRON_FAILED_OUTBOUND_LIMIT);
  const storeItemIds: string[] = [];
  for (const link of links) {
    try {
      console.log("[ebay] cron outbound push", {
        storeItemId: link.storeItemId,
        syncStatus: link.syncStatus,
        syncError: link.syncError?.slice(0, 120) ?? null,
      });
      await updateStoreItemOnChannels(link.storeItemId, {
        skipProviders: ["etsy", "wix", "shopify"],
      });
      storeItemIds.push(link.storeItemId);
    } catch (e) {
      console.error("[ebay] cron failed-outbound push threw", {
        storeItemId: link.storeItemId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { attempted: storeItemIds.length, storeItemIds };
}
