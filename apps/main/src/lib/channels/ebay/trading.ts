import {
  EBAY_API_BASE,
  EBAY_TRADING_COMPAT_LEVEL,
  EBAY_TRADING_SITE_ID,
} from "./config";
import { ebayGet, ebayJson } from "./client";
import { EbayApiError } from "./errors";
import { describeEbayThrownError, extractBulkMigrateResponse, formatMigrateListingError } from "./errors";
import { allTags, extractEbayItemPhotos, normalizeEbayPhotoUrl, tag } from "./photos";
import {
  parseEbayDescription,
  parseEbayItemSpecifics,
  parseEbayPrimaryCategory,
} from "./item-specifics";
import type { ListingAspect } from "@/lib/listing-limits";

/** A classic (Trading API) eBay listing enumerated for import preview. */
export type EbayTradingListing = {
  listingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
  /** eBay leaf category id (from PrimaryCategory) when known. */
  remoteCategoryId?: string | null;
  categoryName?: string | null;
};

/** Full item specifics + description for a listing (fetched on import, not preview). */
export type EbayItemDetails = {
  aspects: ListingAspect[];
  remoteCategoryId: string | null;
  categoryName: string | null;
  description: string | null;
};

const TRADING_ENDPOINT = `${EBAY_API_BASE}/ws/api.dll`;

function buildGetMyeBaySellingXml(pageNumber: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

function buildGetItemXml(listingId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${listingId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`;
}

async function callTrading(accessToken: string, callName: string, xml: string): Promise<string> {
  const res = await fetch(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": EBAY_TRADING_SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": EBAY_TRADING_COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay Trading ${callName} failed (${res.status}).`);
  }
  return text;
}

/** Fallback when GetMyeBaySelling omits picture URLs (common for gallery-only rows). */
async function fetchEbayItemPhotos(accessToken: string, listingId: string): Promise<string[]> {
  try {
    const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(listingId));
    const item = tag(xml, "Item") ?? xml;
    return extractEbayItemPhotos(item);
  } catch {
    return [];
  }
}

/**
 * Fetch full item specifics + primary category + description for one listing via GetItem.
 * Used on import (not preview) so we round-trip the details eBay requires for two-way sync.
 */
export async function fetchEbayItemDetails(
  accessToken: string,
  listingId: string
): Promise<EbayItemDetails> {
  try {
    const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(listingId));
    const item = tag(xml, "Item") ?? xml;
    const { categoryId, categoryName } = parseEbayPrimaryCategory(item);
    return {
      aspects: parseEbayItemSpecifics(item),
      remoteCategoryId: categoryId,
      categoryName,
      description: parseEbayDescription(item),
    };
  } catch {
    return { aspects: [], remoteCategoryId: null, categoryName: null, description: null };
  }
}

async function enrichPhotosFromInventoryApi(
  accessToken: string,
  listings: EbayTradingListing[]
): Promise<void> {
  const needs = listings.filter((l) => l.photos.length === 0);
  if (needs.length === 0) return;

  const needIds = new Set(needs.map((l) => l.listingId));
  type OfferRow = {
    sku?: string;
    listing?: { listingId?: string };
  };
  type InventoryProduct = { imageUrls?: string[] };

  const photosByListingId = new Map<string, string[]>();
  let offset = 0;
  for (let page = 0; page < 5; page += 1) {
    const res = await ebayGet<{ offers?: OfferRow[] }>(
      accessToken,
      `/sell/inventory/v1/offer?marketplace_id=EBAY_US&limit=200&offset=${offset}`
    ).catch(() => null);
    const offers = res?.offers ?? [];
    for (const offer of offers) {
      const listingId = offer.listing?.listingId;
      const sku = offer.sku;
      if (!listingId || !sku || !needIds.has(listingId) || photosByListingId.has(listingId)) {
        continue;
      }
      const inv = await ebayGet<{ product?: InventoryProduct }>(
        accessToken,
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`
      ).catch(() => null);
      const urls = (inv?.product?.imageUrls ?? [])
        .map((u) => normalizeEbayPhotoUrl(u))
        .filter((u): u is string => Boolean(u));
      if (urls.length > 0) photosByListingId.set(listingId, urls);
    }
    if (offers.length < 200 || photosByListingId.size >= needIds.size) break;
    offset += 200;
  }

  for (const listing of needs) {
    const fromInventory = photosByListingId.get(listing.listingId);
    if (fromInventory?.length) {
      listing.photos = fromInventory;
      continue;
    }
    const fromGetItem = await fetchEbayItemPhotos(accessToken, listing.listingId);
    if (fromGetItem.length > 0) listing.photos = fromGetItem;
  }
}

/** Enumerate the seller's active classic listings via Trading API GetMyeBaySelling. */
export async function enumerateEbayListings(accessToken: string): Promise<EbayTradingListing[]> {
  const out: EbayTradingListing[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const xml = await callTrading(accessToken, "GetMyeBaySelling", buildGetMyeBaySellingXml(page));
    const activeList = tag(xml, "ActiveList") ?? "";
    const itemArray = tag(activeList, "ItemArray") ?? "";
    const items = allTags(itemArray, "Item");
    if (items.length === 0) break;
    for (const item of items) {
      const listingId = tag(item, "ItemID");
      if (!listingId) continue;
      const title = tag(item, "Title") ?? "eBay listing";
      const sellingStatus = tag(item, "SellingStatus") ?? "";
      const priceStr = tag(sellingStatus, "CurrentPrice") ?? tag(item, "CurrentPrice") ?? "0";
      const priceCents = Math.round((Number(priceStr) || 0) * 100);
      const qtyStr = tag(item, "QuantityAvailable") ?? tag(item, "Quantity") ?? "0";
      const quantity = Math.max(0, Number(qtyStr) || 0);
      const photos = extractEbayItemPhotos(item);
      const { categoryId, categoryName } = parseEbayPrimaryCategory(item);
      out.push({
        listingId,
        title,
        priceCents,
        quantity,
        photos,
        remoteCategoryId: categoryId,
        categoryName,
      });
    }
    // Stop early if this page was not full (no further pages).
    if (items.length < 100) break;
  }
  await enrichPhotosFromInventoryApi(accessToken, out);
  return out;
}

type MigrateResponse = {
  responses?: {
    listingId?: string;
    statusCode?: number;
    inventoryItems?: { sku?: string; offerId?: string }[];
    offers?: { offerId?: string }[];
    errors?: { errorId?: number; message?: string; longMessage?: string }[];
  }[];
};

export type MigrationResult = { sku?: string; offerId?: string; error?: string };

function formatMigrationError(e: unknown): string {
  return describeEbayThrownError(e);
}

/** Listing may already be on the Inventory model from a prior partial migrate. */
async function findExistingInventorySku(
  accessToken: string,
  listingId: string
): Promise<{ sku: string; offerId?: string } | null> {
  type OfferRow = { sku?: string; offerId?: string; listing?: { listingId?: string } };
  let offset = 0;
  for (let page = 0; page < 5; page += 1) {
    const res = await ebayGet<{ offers?: OfferRow[] }>(
      accessToken,
      `/sell/inventory/v1/offer?marketplace_id=EBAY_US&limit=200&offset=${offset}`
    ).catch(() => null);
    const offers = res?.offers ?? [];
    for (const offer of offers) {
      if (offer.listing?.listingId === listingId && offer.sku) {
        return { sku: offer.sku, offerId: offer.offerId };
      }
    }
    if (offers.length < 200) break;
    offset += 200;
  }
  return null;
}

function applyMigrateResponse(
  result: Map<string, MigrationResult>,
  res: MigrateResponse,
  batch: string[]
): void {
  for (const r of res.responses ?? []) {
    if (!r.listingId) continue;
    const ok = r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300;
    if (!ok) {
      result.set(r.listingId, { error: formatMigrateListingError(r) });
      continue;
    }
    const sku = r.inventoryItems?.[0]?.sku;
    if (!sku) {
      result.set(r.listingId, { error: "migration_missing_sku" });
      continue;
    }
    result.set(r.listingId, {
      sku,
      offerId: r.offers?.[0]?.offerId ?? r.inventoryItems?.[0]?.offerId,
    });
  }
  for (const id of batch) {
    if (!result.has(id)) result.set(id, { error: "no_response" });
  }
}

async function migrateListingBatch(
  accessToken: string,
  listingIds: string[]
): Promise<MigrateResponse> {
  const validIds = listingIds.filter((id) => /^\d+$/.test(id.trim()));
  if (validIds.length === 0) {
    throw new Error("Invalid eBay listing id — expected a numeric Item ID from your active listings.");
  }
  const payload = { requests: validIds.map((listingId) => ({ listingId: listingId.trim() })) };
  try {
    return await ebayJson<MigrateResponse>(
      accessToken,
      "/sell/inventory/v1/bulk_migrate_listing",
      "POST",
      payload
    );
  } catch (e) {
    // eBay sometimes returns HTTP 400/500 with a bulk `responses` array instead of top-level `errors`.
    if (e instanceof EbayApiError) {
      const bulk = extractBulkMigrateResponse(e.body);
      if (bulk) {
        console.warn("[ebay] bulk_migrate_listing returned non-2xx with per-listing responses", {
          httpStatus: e.status,
          listingIds: validIds,
        });
        return bulk;
      }
      console.error("[ebay] bulk_migrate_listing failed", {
        httpStatus: e.status,
        listingIds: validIds,
        body: e.body,
      });
    }
    throw e;
  }
}

/**
 * Bring classic listings under the Inventory model so unified inventory updates work.
 * Returns a map listingId -> { sku, offerId } (or an error reason).
 */
export async function migrateEbayListings(
  accessToken: string,
  listingIds: string[]
): Promise<Map<string, MigrationResult>> {
  const result = new Map<string, MigrationResult>();
  const pending: string[] = [];

  for (const listingId of listingIds) {
    const existing = await findExistingInventorySku(accessToken, listingId);
    if (existing) {
      result.set(listingId, { sku: existing.sku, offerId: existing.offerId });
    } else {
      pending.push(listingId);
    }
  }

  // bulk_migrate_listing accepts up to 5 listings per call and is known to be flaky (HTTP 500).
  for (let i = 0; i < pending.length; i += 5) {
    const batch = pending.slice(i, i + 5);
    try {
      const res = await migrateListingBatch(accessToken, batch);
      applyMigrateResponse(result, res, batch);
      continue;
    } catch (batchErr) {
      console.warn("[ebay] bulk_migrate_listing batch failed; retrying one-by-one", {
        batch,
        error: formatMigrationError(batchErr),
      });
    }

    for (const listingId of batch) {
      if (result.has(listingId)) continue;
      try {
        const res = await migrateListingBatch(accessToken, [listingId]);
        applyMigrateResponse(result, res, [listingId]);
      } catch (singleErr) {
        result.set(listingId, { error: formatMigrationError(singleErr) });
      }
    }
  }

  return result;
}
