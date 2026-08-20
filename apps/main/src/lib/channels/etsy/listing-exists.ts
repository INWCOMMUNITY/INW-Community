import { etsyGet } from "./client";

/** Etsy states that mean the listing is no longer sellable on the shop. */
export function etsyListingStateMeansGone(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return s === "removed" || s === "expired" || s === "sold_out";
}

/**
 * True when the listing is gone (404 or Etsy reports removed/expired/sold_out).
 * Active/draft/inactive still exist — do not sold-out INW from a partial active-only catalog.
 */
export async function etsyListingIsGone(
  accessToken: string,
  listingId: string
): Promise<boolean> {
  const listing = await etsyGet<{ state?: string } | null>(
    accessToken,
    `/listings/${encodeURIComponent(listingId)}`,
    { notFoundOk: true }
  );
  if (!listing) return true;
  return etsyListingStateMeansGone(listing.state);
}
