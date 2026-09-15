/**
 * Probe which Inventory SKU actually hosts the live eBay listing.
 * Hub-minted INW join keys often are not the Inventory pin.
 */

import { ebayGet } from "./client";
import { EBAY_MARKETPLACE_ID } from "./config";
import {
  ebayInventorySkuCandidates,
  resolveEbayPushSku,
  type EbayPushSkuArgs,
} from "./listing-origin";
import { resolveEbayLegacyListingId } from "./mapping";
import { isValidEbayInventorySku } from "./migrate-prep";
import { fetchLiveInventoryItem } from "./passthrough-push";
import {
  ebayOfferIsPublished,
  pickEbayOffer,
  readEbayOfferListingId,
} from "./publish-policy";

type OfferRow = {
  offerId?: string;
  status?: string;
  listing?: { listingId?: string | number | null } | null;
  listingId?: string | number | null;
};

export function uniqueEbayInventorySkuCandidates(candidates: string[]): string[] {
  const out: string[] = [];
  for (const raw of candidates) {
    const sku = raw.trim();
    if (!sku || !isValidEbayInventorySku(sku) || out.includes(sku)) continue;
    out.push(sku);
  }
  return out;
}

async function listOffersForSku(accessToken: string, sku: string): Promise<OfferRow[]> {
  try {
    const res = await ebayGet<{ offers?: OfferRow[] }>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    return res.offers ?? [];
  } catch {
    return [];
  }
}

/**
 * First candidate whose offer is the live Item ID, else a published offer, else an
 * inventory_item that exists. Returns null when none of the pins are on eBay yet
 * (first publish).
 */
export async function resolveLiveEbayInventorySku(
  accessToken: string,
  candidates: string[],
  opts?: { preferListingId?: string | null }
): Promise<string | null> {
  const unique = uniqueEbayInventorySkuCandidates(candidates);
  if (unique.length === 0) return null;

  const prefer = opts?.preferListingId?.trim() || null;
  const snapshots: { sku: string; offers: OfferRow[] }[] = [];
  for (const sku of unique) {
    const offers = await listOffersForSku(accessToken, sku);
    snapshots.push({ sku, offers });
    if (prefer && offers.some((offer) => readEbayOfferListingId(offer) === prefer)) {
      return sku;
    }
  }

  for (const { sku, offers } of snapshots) {
    const picked = pickEbayOffer(offers);
    if (picked && ebayOfferIsPublished(picked.status)) return sku;
  }

  for (const sku of unique) {
    const live = await fetchLiveInventoryItem(accessToken, sku);
    if (live) return sku;
  }
  return null;
}

/** Inventory SKU for push/catch-up: live pin when one exists, otherwise the join-key guess. */
export async function resolveEbayLivePushSku(
  accessToken: string,
  args: EbayPushSkuArgs
): Promise<string> {
  const guessed = resolveEbayPushSku(args);
  const live = await resolveLiveEbayInventorySku(
    accessToken,
    ebayInventorySkuCandidates(args),
    { preferListingId: resolveEbayLegacyListingId(args.externalListingId) }
  );
  if (live && live !== guessed) {
    console.info("[ebay] live Inventory SKU pin differs from join key", {
      guessed,
      live,
      itemId: args.itemId,
      listingId: resolveEbayLegacyListingId(args.externalListingId),
    });
  }
  return live ?? guessed;
}
