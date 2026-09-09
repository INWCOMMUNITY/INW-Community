import { SYNC_ECHO_SKEW_MS } from "./sync-baseline";

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
}): boolean {
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
