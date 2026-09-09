import { etsyGet } from "./client";
import { etsyListingToSummary } from "./mapping";
import type { RemoteListingSummary } from "../types";

/** Etsy states that mean the listing is no longer sellable on the shop. */
export function etsyListingStateMeansGone(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return s === "removed" || s === "expired" || s === "sold_out";
}

/** True when the listing is not live in the shop (hidden, ended, or deleted). */
export function etsyListingIsNotActive(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  if (!s) return false;
  return s !== "active";
}

/**
 * Shop `state=active` lists omit inactive/draft rows and can lag a just-saved listing.
 * Hydrate those linked rows (and any list row with no last_modified) via GET by id.
 */
export function etsyLinkedListingNeedsHydrate(
  existing: { remoteUpdatedAt?: Date | null } | null | undefined
): boolean {
  return existing == null || existing.remoteUpdatedAt == null;
}

export type EtsyInboundFetch =
  | { status: "gone" }
  | { status: "ok"; summary: RemoteListingSummary; state: string | null };

/**
 * Fetch one listing for inbound reconcile. Draft/inactive still exist — only
 * 404 / removed / expired / sold_out are gone.
 */
type EtsyListingWithState = Parameters<typeof etsyListingToSummary>[0] & {
  state?: string | null;
};

export async function fetchEtsyListingForInbound(
  accessToken: string,
  listingId: string
): Promise<EtsyInboundFetch> {
  const id = listingId.trim().replace(/^inw/i, "");
  if (!id) return { status: "gone" };
  const listing = await etsyGet<EtsyListingWithState>(
    accessToken,
    `/listings/${encodeURIComponent(id)}?includes=Images`,
    { notFoundOk: true }
  );
  if (!listing) return { status: "gone" };
  if (etsyListingStateMeansGone(listing.state)) return { status: "gone" };
  return {
    status: "ok",
    summary: etsyListingToSummary(listing),
    state: listing.state ?? null,
  };
}

/**
 * True when the listing is gone (404 or Etsy reports removed/expired/sold_out).
 * Active/draft/inactive still exist — do not sold-out INW from a partial active-only catalog.
 */
export async function etsyListingIsGone(
  accessToken: string,
  listingId: string
): Promise<boolean> {
  const fetched = await fetchEtsyListingForInbound(accessToken, listingId);
  return fetched.status === "gone";
}
