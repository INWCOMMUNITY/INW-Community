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
 * Hydrate those linked rows, list qty 0 (untrusted), and title/qty disagreements.
 * Shop-list `quantity` is often 0 for variation listings that still have offering stock.
 */
export const ETSY_CRON_HYDRATE_LIMIT = 20;

/**
 * Shop-list rows can lag a just-saved listing. If this tick needed a GET but did
 * not receive one (hydrate cap or failure), do not pull/push from the list row.
 */
export function etsyCatalogShouldNoopUnhydrated(args: {
  needsHydrate: boolean;
  hydratedThisTick: boolean;
}): boolean {
  return args.needsHydrate && !args.hydratedThisTick;
}

export function etsyShopListQuantityIsTrusted(args: {
  quantity: number;
  inventoryEnriched: boolean;
}): boolean {
  if (args.inventoryEnriched) return true;
  return args.quantity > 0;
}

/** Combine listing.quantityKnown with shop-list zero distrust. */
export function etsyRemoteQuantityIsKnown(args: {
  quantity: number;
  quantityKnown?: boolean;
  inventoryEnriched: boolean;
}): boolean {
  if (args.quantityKnown === false) return false;
  return etsyShopListQuantityIsTrusted({
    quantity: args.quantity,
    inventoryEnriched: args.inventoryEnriched,
  });
}

/** Shop-list qty 0 is often a live variation listing. Do not PATCH Etsy to INW zero from it. */
export function shouldSkipEtsyUntrustedZeroPush(args: {
  inwQuantity: number;
  remoteQtyKnown: boolean;
}): boolean {
  return args.inwQuantity <= 0 && !args.remoteQtyKnown;
}

/** Inactive/draft GET rows are not an active-shop quantity source (includes our sell-out deactivate). */
export function etsyHydrateBelongsInActiveCatalog(state: string | null | undefined): boolean {
  return !etsyListingIsNotActive(state);
}

/** Lower is first. Prefer missing-from-list and false shop-list zeros over other dirty rows. */
export function etsyInboundHydratePriority(
  remote: { quantity?: number } | null | undefined,
  inwQuantity: number
): number {
  if (remote == null) return 0;
  if ((remote.quantity ?? 0) <= 0 && inwQuantity > 0) return 1;
  if ((remote.quantity ?? 0) <= 0) return 2;
  return 3;
}

export function etsyLinkedListingNeedsHydrate(
  existing:
    | {
        remoteUpdatedAt?: Date | null;
        title?: string;
        quantity?: number;
      }
    | null
    | undefined,
  inw?: {
    title: string;
    quantity: number;
    updatedAt?: Date | null;
    baselineAt?: Date | null;
  }
): boolean {
  if (existing == null || existing.remoteUpdatedAt == null) return true;
  if (!inw) return false;
  if ((existing.quantity ?? 0) <= 0) return true;
  if ((existing.title ?? "").trim().slice(0, 200) !== inw.title.trim().slice(0, 200)) return true;
  if ((existing.quantity ?? 0) !== inw.quantity) return true;
  const remoteMs = existing.remoteUpdatedAt.getTime();
  if (inw.baselineAt && remoteMs > inw.baselineAt.getTime()) return true;
  if (inw.updatedAt && remoteMs > inw.updatedAt.getTime()) return true;
  return false;
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
