/** Hide the shop pill unless this item is actually live on that shop. */
export function channelLinkShowsOnItem(link: {
  remoteDeletedProvider?: string | null;
  connectionStatus?: string | null;
  ebayListingEnded?: boolean;
  remoteCatalogState?: string | null;
}): boolean {
  if (link.remoteDeletedProvider) return false;
  if (link.connectionStatus === "disconnected") return false;
  if (link.ebayListingEnded) return false;
  if (
    link.remoteCatalogState === "inactive" ||
    link.remoteCatalogState === "inactive_outside_catalog" ||
    link.remoteCatalogState === "linked_other_channel"
  ) {
    return false;
  }
  return true;
}
