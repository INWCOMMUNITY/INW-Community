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
