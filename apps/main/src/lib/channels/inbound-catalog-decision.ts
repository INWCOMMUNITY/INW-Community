import { isSyncEchoWindow, resolveSyncDirection, SYNC_ECHO_SKEW_MS } from "./sync-baseline";

/**
 * Inbound catalog should not rewrite a channel listing when the StoreItem hash drifted
 * (CDN photo re-host, description HTML vs plain text) but title/price/qty still match.
 */
export function isInboundCatalogContentEcho(args: {
  inwContentChanged: boolean;
  remoteContentChanged: boolean;
  qtyDiffers: boolean;
  titleOrPriceDiffers: boolean;
  descriptionDiffers: boolean;
  remoteContentActuallyDiffers: boolean;
  marketplaceCdnPhotoRehostOnly: boolean;
  inwHostedPhotosChangedSinceLastPush: boolean;
}): boolean {
  if (!args.inwContentChanged || args.remoteContentChanged || args.qtyDiffers) return false;
  if (args.titleOrPriceDiffers || args.descriptionDiffers) return false;
  if (args.inwHostedPhotosChangedSinceLastPush) return false;
  return !args.remoteContentActuallyDiffers || args.marketplaceCdnPhotoRehostOnly;
}

/**
 * True when the channel timestamp bump is our own outbound write echoing back
 * (Wix/Etsy lastUpdated advances on every PATCH, which is not a seller edit).
 */
export function isOwnChannelPushEcho(args: {
  lastPushedAt: Date | null;
  remoteUpdatedAt: Date | null;
  inwUpdatedAt?: Date | null;
  nowMs?: number;
  /** Title/price/qty actually differ — not a CDN/timestamp bounce. */
  listingsDisagree?: boolean;
}): boolean {
  if (args.listingsDisagree) {
    if (!args.lastPushedAt || !args.remoteUpdatedAt) return false;
    return (
      Math.abs(args.remoteUpdatedAt.getTime() - args.lastPushedAt.getTime()) < SYNC_ECHO_SKEW_MS
    );
  }
  if (args.lastPushedAt) {
    const now = args.nowMs ?? Date.now();
    if (now - args.lastPushedAt.getTime() < SYNC_ECHO_SKEW_MS) return true;
    if (
      args.remoteUpdatedAt &&
      Math.abs(args.remoteUpdatedAt.getTime() - args.lastPushedAt.getTime()) < SYNC_ECHO_SKEW_MS
    ) {
      return true;
    }
  }
  return isHubFanoutTimestampEcho({
    inwUpdatedAt: args.inwUpdatedAt ?? null,
    remoteUpdatedAt: args.remoteUpdatedAt,
  });
}

/**
 * Shopify/Etsy inbound fan-out PATCHes Wix within a few seconds of INW.updatedAt.
 * That lastUpdated bump is not a seller conflict. Logged production pairs were 2–7s apart.
 */
export function isHubFanoutTimestampEcho(args: {
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
}): boolean {
  if (!args.inwUpdatedAt || !args.remoteUpdatedAt) return false;
  return Math.abs(args.remoteUpdatedAt.getTime() - args.inwUpdatedAt.getTime()) < SYNC_ECHO_SKEW_MS;
}

/**
 * Semantic disagreement used to decide a real marketplace edit vs hash/CDN drift.
 * Empty remote descriptions are omitted from shop list payloads and must not count.
 */
export function remoteListingDisagreesForSync(args: {
  titleOrPriceDiffers: boolean;
  descriptionDiffers: boolean;
  remoteDescriptionPresent: boolean;
  photosDiffer: boolean;
  marketplaceCdnPhotoRehostOnly: boolean;
}): boolean {
  if (args.titleOrPriceDiffers) return true;
  if (args.remoteDescriptionPresent && args.descriptionDiffers) return true;
  if (args.photosDiffer && !args.marketplaceCdnPhotoRehostOnly) return true;
  return false;
}

/**
 * Channel-side "changed since baseline". Timestamp + hash mismatch is not enough:
 * Wix re-hosts photos (hash never matches INW blob URLs) and bumps lastUpdated on
 * our own push. Require a real listing disagreement and skip our write echo.
 */
export function remoteCatalogChangedSinceBaseline(args: {
  remoteTimestampNewer: boolean;
  remoteHashDiffersFromBaseline: boolean;
  remoteDisagreesWithInw: boolean;
  titleOrPriceDiffers: boolean;
  descriptionDiffers: boolean;
  inwContentChanged: boolean;
  isOwnPushEcho: boolean;
  remoteUpdatedAt: Date | null;
}): boolean {
  if (args.isOwnPushEcho) return false;

  const remoteListEditVisible =
    !args.inwContentChanged &&
    (args.titleOrPriceDiffers ||
      (args.remoteUpdatedAt == null && args.descriptionDiffers));
  if (remoteListEditVisible) return true;

  return args.remoteTimestampNewer && args.remoteHashDiffersFromBaseline && args.remoteDisagreesWithInw;
}

/** Dual-edit conflict only when INW and the channel actually disagree. */
export function shouldLogCatalogConflict(args: {
  inwContentChanged: boolean;
  remoteContentChanged: boolean;
  remoteDisagreesWithInw: boolean;
  inwUpdatedAt?: Date | null;
  remoteUpdatedAt?: Date | null;
}): boolean {
  if (
    isHubFanoutTimestampEcho({
      inwUpdatedAt: args.inwUpdatedAt ?? null,
      remoteUpdatedAt: args.remoteUpdatedAt ?? null,
    })
  ) {
    return false;
  }
  return args.inwContentChanged && args.remoteContentChanged && args.remoteDisagreesWithInw;
}

/**
 * Qty-only inbound: pull when the channel quantity moved and INW did not.
 * A missing baseline must not fall through to pushing INW over a real Etsy edit.
 */
export function remoteQtyOnlyShouldPull(args: {
  remoteQtyKnown: boolean;
  remoteQuantity: number;
  inwQuantity: number;
  baselineQty: number | null;
  inwQtyChangedSinceBaseline: boolean;
}): boolean {
  if (!args.remoteQtyKnown) return false;
  if (args.remoteQuantity === args.inwQuantity) return false;
  if (args.inwQtyChangedSinceBaseline) return false;
  if (args.baselineQty == null) return true;
  return args.remoteQuantity !== args.baselineQty;
}

/**
 * Quantity last-write-wins. Mirrors {@link resolveSyncDirection}'s "most recent" arm but
 * scoped to stock: pull the channel quantity when the channel was edited most recently.
 *
 * Unlike {@link remoteQtyOnlyShouldPull}, this does NOT treat any INW baseline drift as an
 * INW edit. A sale on another channel (or a prior partial sync) drifts `syncBaselineQty`
 * without being a newer INW quantity edit; the old helper read that drift as "INW changed"
 * and pushed INW's stale quantity back over a real channel edit (the reported snap-back).
 * When both sides differ from baseline we decide by recency using `remoteUpdatedAt` vs
 * `inwUpdatedAt`, falling back to whether INW was edited after the agreed baseline.
 */
export function newerChannelQtyEditShouldPull(args: {
  remoteQtyKnown: boolean;
  remoteQuantity: number;
  inwQuantity: number;
  inwQtyChangedSinceBaseline: boolean;
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  baselineAt: Date | null;
}): boolean {
  if (!args.remoteQtyKnown) return false;
  if (args.remoteQuantity === args.inwQuantity) return false;
  // Our own qty push echoing back within the settle window is not a channel edit.
  if (isSyncEchoWindow(args.baselineAt)) return false;
  // INW quantity has not moved since the last agreed baseline: only the channel changed,
  // so the channel edit is the most recent — pull.
  if (!args.inwQtyChangedSinceBaseline) return true;
  // Both sides differ from baseline — most recent edit wins by timestamp.
  if (args.remoteUpdatedAt) {
    if (!args.inwUpdatedAt) return true;
    return args.remoteUpdatedAt.getTime() > args.inwUpdatedAt.getTime();
  }
  // No channel timestamp: pull only if INW was not genuinely edited after the baseline.
  if (!args.inwUpdatedAt || !args.baselineAt) return false;
  return args.inwUpdatedAt.getTime() <= args.baselineAt.getTime();
}

/**
 * Do not push INW quantity to the channel when we could not read the true remote quantity
 * this tick (an Etsy variation listing not hydrated, or an untrusted shop-list zero) AND the
 * remote listing may have been edited at/after our last agreed baseline. Pushing INW's stock
 * here risks reverting a real seller edit we simply have not hydrated yet. The link is
 * prioritized for hydration on a later tick, after which the direction resolves normally.
 * If the remote timestamp proves INW is strictly newer, an INW push is safe (not held).
 */
export function shouldHoldQtyPushForUntrustedRemote(args: {
  provider: string;
  remoteQtyKnown: boolean;
  remoteUpdatedAt: Date | null;
  inwUpdatedAt: Date | null;
}): boolean {
  if (args.provider !== "etsy") return false;
  if (args.remoteQtyKnown) return false;
  if (
    args.remoteUpdatedAt &&
    args.inwUpdatedAt &&
    args.inwUpdatedAt.getTime() > args.remoteUpdatedAt.getTime()
  ) {
    return false;
  }
  return true;
}

/**
 * Last-write-wins gate for a webhook / on-demand refresh pull (e.g. Etsy). Mirrors the cron's
 * per-link decision so a refresh can't overwrite a newer un-pushed Hub edit or re-apply our own
 * push echoing back. Pull only when the remote genuinely won and it isn't our echo.
 */
export function inboundRefreshShouldPull(args: {
  inwContentChanged: boolean;
  remoteContentChanged: boolean;
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  ownPushEcho: boolean;
}): boolean {
  if (args.ownPushEcho) return false;
  return (
    resolveSyncDirection({
      inwChanged: args.inwContentChanged,
      remoteChanged: args.remoteContentChanged,
      inwUpdatedAt: args.inwUpdatedAt,
      remoteUpdatedAt: args.remoteUpdatedAt,
    }) === "pull"
  );
}

/**
 * Last-write-wins for per-SKU prices on a webhook / on-demand refresh.
 * A remote snapshot with no SKU prices is unknown — never a pull.
 */
export function inboundRefreshShouldPullVariantPrices(args: {
  inwVariantsChanged: boolean;
  remotePricesKnown: boolean;
  remotePriceFingerprint: string;
  inwPriceFingerprint: string;
  inwUpdatedAt: Date | null;
  remoteUpdatedAt: Date | null;
  ownPushEcho: boolean;
}): boolean {
  if (args.ownPushEcho) return false;
  if (!args.remotePricesKnown) return false;
  if (!args.remotePriceFingerprint || args.remotePriceFingerprint === args.inwPriceFingerprint) {
    return false;
  }
  return (
    resolveSyncDirection({
      inwChanged: args.inwVariantsChanged,
      remoteChanged: true,
      inwUpdatedAt: args.inwUpdatedAt,
      remoteUpdatedAt: args.remoteUpdatedAt,
    }) === "pull"
  );
}

/**
 * Wix must never flag a listing "remotely deleted" from catalog absence alone. An empty or
 * truncated catalog read (transient glitch, page cap) would otherwise mass-flag every listing.
 * Only flag when a per-product probe (`wixProductIsGone`) confirms the product is gone, the
 * listing isn't already flagged, and the INW item is still live.
 */
export function shouldFlagWixRemoteDeleted(args: {
  confirmedGone: boolean;
  alreadyPending: boolean;
  storeItemStatus: string;
}): boolean {
  if (!args.confirmedGone) return false;
  if (args.alreadyPending) return false;
  if (args.storeItemStatus === "sold_out" || args.storeItemStatus === "inactive") return false;
  return true;
}
