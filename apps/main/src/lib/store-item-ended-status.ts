/** Ended INW listings are removed from our records after this window. Third-party shops are not touched. */
export const ENDED_LISTING_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export const END_LISTING_CONFIRM =
  "End this listing on INW? It leaves our storefront. Listings on eBay, Etsy, and other shops stay up. Ended INW listings are removed after 14 days.";

export const END_LISTINGS_CONFIRM =
  "End these listings on INW? They leave our storefront. Listings on eBay, Etsy, and other shops stay up. Ended INW listings are removed after 14 days.";

export function inactiveStoreItemData(now = new Date()): { status: "inactive"; endedAt: Date } {
  return { status: "inactive", endedAt: now };
}

/** Status write that starts or clears the 14-day ended clock. */
export function storeItemStatusWrite(
  nextStatus: string,
  previousStatus?: string | null,
  now = new Date()
): { status: string; endedAt?: Date | null } {
  if (nextStatus === "inactive") {
    if (previousStatus === "inactive") return { status: nextStatus };
    return { status: nextStatus, endedAt: now };
  }
  return { status: nextStatus, endedAt: null };
}
