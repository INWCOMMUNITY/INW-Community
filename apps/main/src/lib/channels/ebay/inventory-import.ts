import { ebayGet } from "./client";
import { normalizeEbayPhotoUrl } from "./photos";
import type { EbayTradingListing } from "./trading";
import { EBAY_MARKETPLACE_ID } from "./config";

export type EbayInventoryListRow = {
  sku?: string;
  product?: { title?: string; imageUrls?: string[] };
  availability?: { shipToLocationAvailability?: { quantity?: number } };
  packageWeightAndSize?: {
    dimensions?: { height?: number; length?: number; width?: number; unit?: string };
    weight?: { value?: number; unit?: string };
  };
};

type InventoryListResponse = {
  inventoryItems?: EbayInventoryListRow[];
  next?: string;
  total?: number;
};

export async function listInventoryItems(accessToken: string): Promise<EbayInventoryListRow[]> {
  const rows: EbayInventoryListRow[] = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 20; page += 1) {
    const res = await ebayGet<InventoryListResponse>(
      accessToken,
      `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`
    );
    rows.push(...(res.inventoryItems ?? []));
    const fetched = res.inventoryItems?.length ?? 0;
    if (fetched < limit) break;
    offset += fetched;
  }

  return rows;
}

export type EbayOfferFulfillmentRef = {
  sku?: string | null;
  listingId?: string | null;
  fulfillmentPolicyId?: string | null;
};

export type EbayOfferFulfillmentIndex = {
  bySku: Map<string, string>;
  byListingId: Map<string, string>;
};

export function emptyOfferFulfillmentIndex(): EbayOfferFulfillmentIndex {
  return { bySku: new Map(), byListingId: new Map() };
}

export function indexOfferFulfillmentPolicies(
  offers: EbayOfferFulfillmentRef[]
): EbayOfferFulfillmentIndex {
  const index = emptyOfferFulfillmentIndex();
  for (const offer of offers) {
    const policyId = offer.fulfillmentPolicyId?.trim();
    if (!policyId) continue;
    const sku = offer.sku?.trim();
    if (sku) index.bySku.set(sku, policyId);
    const listingId = offer.listingId?.trim();
    if (listingId) index.byListingId.set(listingId, policyId);
  }
  return index;
}

export function resolveEbayListingFulfillmentPolicyId(args: {
  tradingProfileId?: string | null;
  listingId?: string | null;
  sku?: string | null;
  offerIndex: EbayOfferFulfillmentIndex;
}): string | null {
  const fromTrading = args.tradingProfileId?.trim();
  if (fromTrading) return fromTrading;
  const listingId = args.listingId?.trim();
  if (listingId) {
    const fromListing = args.offerIndex.byListingId.get(listingId);
    if (fromListing) return fromListing;
  }
  const sku = args.sku?.trim();
  if (sku) {
    const fromSku = args.offerIndex.bySku.get(sku);
    if (fromSku) return fromSku;
  }
  return null;
}

type EbayOfferListRow = {
  sku?: string;
  listingId?: string;
  listing?: { listingId?: string };
  listingPolicies?: { fulfillmentPolicyId?: string };
};

type OfferListResponse = {
  offers?: EbayOfferListRow[];
  total?: number;
};

/** Paginate Inventory offers so import can use each listing's fulfillment policy, not the shop default. */
export async function listEbayOfferFulfillmentPolicies(
  accessToken: string
): Promise<EbayOfferFulfillmentIndex> {
  const rows: EbayOfferFulfillmentRef[] = [];
  let offset = 0;
  const limit = 200;

  for (let page = 0; page < 20; page += 1) {
    const res = await ebayGet<OfferListResponse>(
      accessToken,
      `/sell/inventory/v1/offer?limit=${limit}&offset=${offset}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    const offers = res.offers ?? [];
    for (const offer of offers) {
      rows.push({
        sku: offer.sku,
        listingId: offer.listing?.listingId ?? offer.listingId,
        fulfillmentPolicyId: offer.listingPolicies?.fulfillmentPolicyId ?? null,
      });
    }
    if (offers.length < limit) break;
    offset += offers.length;
  }

  return indexOfferFulfillmentPolicies(rows);
}

export function inventoryRowToTradingListing(row: EbayInventoryListRow): EbayTradingListing | null {
  const sku = row.sku?.trim();
  if (!sku) return null;
  return {
    listingId: sku,
    title: row.product?.title?.trim() || sku,
    priceCents: 0,
    quantity: Math.max(0, row.availability?.shipToLocationAvailability?.quantity ?? 0),
    photos: (row.product?.imageUrls ?? [])
      .map((url) => normalizeEbayPhotoUrl(url))
      .filter((url): url is string => Boolean(url)),
    sku,
  };
}

export function mergeInventoryRowsWithTrading(
  tradingRows: EbayTradingListing[],
  inventoryRows: EbayInventoryListRow[]
): EbayTradingListing[] {
  const seenSkus = new Set(
    tradingRows.map((row) => row.sku?.trim()).filter((sku): sku is string => Boolean(sku))
  );
  const merged = [...tradingRows];
  for (const row of inventoryRows) {
    const mapped = inventoryRowToTradingListing(row);
    const sku = mapped?.sku?.trim();
    if (!mapped || !sku || seenSkus.has(sku)) continue;
    seenSkus.add(sku);
    merged.push(mapped);
  }
  return merged;
}
