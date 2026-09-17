/** Imports of this many listings (or more) share as one collection post, not individual cards. */
export const LISTING_FEED_COLLECTION_MIN = 3;

/**
 * Public listing-feed collections omit ended (`inactive`) StoreItems.
 * `sold_out` remains visible (existing Sold overlay). Rows are not deleted.
 */
export function isListingFeedCollectionPublicItem(status: string): boolean {
  return status !== "inactive";
}
