import type { SyncStoreItem } from "../types";
import { EBAY_CURRENCY } from "./config";
import { ebayPriceFromCents } from "./mapping";

export type InwBestOfferState = {
  acceptOffers: boolean;
  minOfferCents: number | null;
};

/** Inventory API BestOffer (under offer.listingPolicies.bestOfferTerms). */
export type EbayBestOfferTermsPayload = {
  bestOfferEnabled: boolean;
  autoDeclinePrice?: { value: string; currency: string };
  autoAcceptPrice?: { value: string; currency: string };
};

/** INW only allows make-offer on used listings; new listings disable offers on push. */
export function inwBestOfferEnabled(item: Pick<SyncStoreItem, "acceptOffers" | "condition">): boolean {
  if (item.condition === "new") return false;
  return item.acceptOffers !== false;
}

function readBestOfferTermsRow(
  offer: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const policies = offer?.listingPolicies;
  if (policies && typeof policies === "object") {
    const terms = (policies as { bestOfferTerms?: unknown }).bestOfferTerms;
    if (terms && typeof terms === "object") {
      return terms as Record<string, unknown>;
    }
  }
  const topLevel = offer?.bestOfferTerms;
  if (topLevel && typeof topLevel === "object") {
    return topLevel as Record<string, unknown>;
  }
  return null;
}

function readAmountCents(amount: unknown): number | null {
  if (!amount || typeof amount !== "object") return null;
  const raw = (amount as { value?: unknown }).value;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function readOfferBestOfferTerms(
  offer: Record<string, unknown> | null | undefined
): InwBestOfferState {
  const row = readBestOfferTermsRow(offer);
  if (!row) {
    return { acceptOffers: false, minOfferCents: null };
  }
  const acceptOffers = row.bestOfferEnabled === true;
  if (!acceptOffers) {
    return { acceptOffers: false, minOfferCents: null };
  }

  const declineCents = readAmountCents(row.autoDeclinePrice);
  if (declineCents != null) {
    return { acceptOffers: true, minOfferCents: declineCents + 1 };
  }

  // Legacy payloads (pre-fix) that used minimumBestOfferPrice at offer root.
  const legacyMin = readAmountCents(row.minimumBestOfferPrice);
  return { acceptOffers: true, minOfferCents: legacyMin };
}

export function buildEbayBestOfferTerms(
  item: Pick<SyncStoreItem, "acceptOffers" | "minOfferCents" | "condition">
): EbayBestOfferTermsPayload {
  const bestOfferEnabled = inwBestOfferEnabled(item);
  if (!bestOfferEnabled) {
    return { bestOfferEnabled: false };
  }
  const terms: EbayBestOfferTermsPayload = { bestOfferEnabled: true };
  if (item.minOfferCents != null && item.minOfferCents > 1) {
    // Inventory API uses autoDeclinePrice (offers at/below are declined), not minimumBestOfferPrice.
    terms.autoDeclinePrice = {
      value: ebayPriceFromCents(item.minOfferCents - 1),
      currency: EBAY_CURRENCY,
    };
  }
  return terms;
}

export function applyBestOfferTermsToOfferBody(
  offer: Record<string, unknown>,
  item: Pick<SyncStoreItem, "acceptOffers" | "minOfferCents" | "condition">
): void {
  const existing =
    offer.listingPolicies && typeof offer.listingPolicies === "object"
      ? { ...(offer.listingPolicies as Record<string, unknown>) }
      : {};
  existing.bestOfferTerms = buildEbayBestOfferTerms(item);
  offer.listingPolicies = existing;
  delete offer.bestOfferTerms;
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
