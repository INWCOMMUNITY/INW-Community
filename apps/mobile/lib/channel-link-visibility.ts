function ebayExternalIdLooksLive(id: string | null | undefined): boolean {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return false;
  if (/^\d{9,15}$/.test(trimmed)) return true;
  return /^inw\d{9,15}$/i.test(trimmed);
}

/** Hide the shop pill unless this item is actually live on that shop. */
export function channelLinkShowsOnItem(link: {
  provider?: string;
  externalListingId?: string | null;
  remoteDeletedProvider?: string | null;
  connectionStatus?: string | null;
  ebayListingEnded?: boolean;
  remoteCatalogState?: string | null;
}): boolean {
  if (link.remoteDeletedProvider) return false;
  if (link.connectionStatus === "disconnected") return false;
  if (link.ebayListingEnded) return false;
  if (
    (link.provider ?? "").toLowerCase() === "ebay" &&
    !ebayExternalIdLooksLive(link.externalListingId)
  ) {
    return false;
  }
  if (
    link.remoteCatalogState === "inactive" ||
    link.remoteCatalogState === "inactive_outside_catalog" ||
    link.remoteCatalogState === "linked_other_channel"
  ) {
    return false;
  }
  return true;
}
