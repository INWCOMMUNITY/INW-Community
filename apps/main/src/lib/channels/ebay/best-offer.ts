import type { SyncStoreItem } from "../types";
import { EBAY_CURRENCY } from "./config";
import { ebayPriceFromCents } from "./mapping";

export type InwBestOfferState = {
  acceptOffers: boolean;
  minOfferCents: number | null;
};

export type EbayBestOfferTermsPayload = {
  bestOfferEnabled: boolean;
  minimumBestOfferPrice?: { value: string; currency: string };
};

/** INW only allows make-offer on used listings; new listings disable offers on push. */
export function inwBestOfferEnabled(item: Pick<SyncStoreItem, "acceptOffers" | "condition">): boolean {
  if (item.condition === "new") return false;
  return item.acceptOffers !== false;
}

export function readOfferBestOfferTerms(
  offer: Record<string, unknown> | null | undefined
): InwBestOfferState {
  const terms = offer?.bestOfferTerms;
  if (!terms || typeof terms !== "object") {
    return { acceptOffers: false, minOfferCents: null };
  }
  const row = terms as {
    bestOfferEnabled?: unknown;
    minimumBestOfferPrice?: { value?: unknown };
  };
  const acceptOffers = row.bestOfferEnabled === true;
  const rawMin = row.minimumBestOfferPrice?.value;
  const minNum = rawMin != null ? Number(rawMin) : NaN;
  const minOfferCents =
    Number.isFinite(minNum) && minNum > 0 ? Math.round(minNum * 100) : null;
  return { acceptOffers, minOfferCents };
}

export function buildEbayBestOfferTerms(
  item: Pick<SyncStoreItem, "acceptOffers" | "minOfferCents" | "condition">
): EbayBestOfferTermsPayload {
  const bestOfferEnabled = inwBestOfferEnabled(item);
  if (!bestOfferEnabled) {
    return { bestOfferEnabled: false };
  }
  const terms: EbayBestOfferTermsPayload = { bestOfferEnabled: true };
  if (item.minOfferCents != null && item.minOfferCents > 0) {
    terms.minimumBestOfferPrice = {
      value: ebayPriceFromCents(item.minOfferCents),
      currency: EBAY_CURRENCY,
    };
  }
  return terms;
}

export function applyBestOfferTermsToOfferBody(
  offer: Record<string, unknown>,
  item: Pick<SyncStoreItem, "acceptOffers" | "minOfferCents" | "condition">
): void {
  offer.bestOfferTerms = buildEbayBestOfferTerms(item);
}

export function bestOfferStatesMatch(a: InwBestOfferState, b: InwBestOfferState): boolean {
  return a.acceptOffers === b.acceptOffers && a.minOfferCents === b.minOfferCents;
}

export function inwBestOfferState(
  item: Pick<SyncStoreItem, "acceptOffers" | "minOfferCents" | "condition">
): InwBestOfferState {
  return {
    acceptOffers: inwBestOfferEnabled(item),
    minOfferCents:
      inwBestOfferEnabled(item) && item.minOfferCents != null && item.minOfferCents > 0
        ? item.minOfferCents
        : null,
  };
}
