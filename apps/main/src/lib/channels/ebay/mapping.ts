import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { EBAY_CURRENCY, EBAY_MARKETPLACE_ID, getEbayConfig } from "./config";
import type { EbayConnectionConfig } from "./account";

/** cents -> "12.34" (eBay expects a string decimal price). */
export function ebayPriceFromCents(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

/** Map INW condition to an eBay inventory condition enum. */
export function ebayCondition(condition: string | null): string {
  return condition === "used" ? "USED_EXCELLENT" : "NEW";
}

function plainText(html: string | null, fallback: string): string {
  const text = (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

/** Build the PUT /inventory_item/{sku} body for a StoreItem. */
export function buildEbayInventoryItem(item: SyncStoreItem): Record<string, unknown> {
  const title = item.title.slice(0, 80);
  return {
    availability: {
      shipToLocationAvailability: { quantity: Math.max(0, item.quantity) },
    },
    condition: ebayCondition(item.condition),
    product: {
      title,
      description: plainText(item.description, title),
      imageUrls: item.photos.slice(0, 12),
    },
  };
}

/** Resolve the eBay leaf category for an item (per-item override, else env default). */
function resolveCategoryId(item: SyncStoreItem): string | null {
  if (item.ebayCategoryId != null) return String(item.ebayCategoryId);
  try {
    return getEbayConfig().defaultCategoryId;
  } catch {
    return null;
  }
}

/**
 * Build the POST /offer (and PUT /offer/{offerId}) body. Listing policies + merchant location come
 * from the connection config detected at connect time.
 */
export function buildEbayOffer(
  item: SyncStoreItem,
  cfg: EbayConnectionConfig
): Record<string, unknown> {
  const categoryId = resolveCategoryId(item);
  const offer: Record<string, unknown> = {
    sku: item.id,
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: Math.max(0, item.quantity),
    listingDescription: plainText(item.description, item.title).slice(0, 4000),
    pricingSummary: {
      price: { value: ebayPriceFromCents(item.priceCents), currency: EBAY_CURRENCY },
    },
  };
  if (categoryId) offer.categoryId = categoryId;
  if (cfg.merchantLocationKey) offer.merchantLocationKey = cfg.merchantLocationKey;
  const listingPolicies: Record<string, string> = {};
  if (cfg.fulfillmentPolicyId) listingPolicies.fulfillmentPolicyId = cfg.fulfillmentPolicyId;
  if (cfg.paymentPolicyId) listingPolicies.paymentPolicyId = cfg.paymentPolicyId;
  if (cfg.returnPolicyId) listingPolicies.returnPolicyId = cfg.returnPolicyId;
  if (Object.keys(listingPolicies).length > 0) offer.listingPolicies = listingPolicies;
  return offer;
}

type EbayInventorySummaryRow = {
  sku?: string;
  offerId?: string;
  listingId?: string;
  availableQuantity?: number;
  title?: string;
  price?: { value?: string; currency?: string };
  imageUrls?: string[];
  listing?: { listingId?: string };
};

function priceStringToCents(value?: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Map an eBay inventory/offer summary row to a provider-agnostic import preview entry. */
export function ebayListingToSummary(row: EbayInventorySummaryRow): RemoteListingSummary {
  const externalListingId = row.offerId || row.listingId || row.listing?.listingId || row.sku || "";
  const listingId = row.listingId || row.listing?.listingId;
  return {
    externalListingId,
    title: row.title || "eBay listing",
    description: null,
    priceCents: priceStringToCents(row.price?.value),
    quantity: Math.max(0, row.availableQuantity ?? 0),
    photos: Array.isArray(row.imageUrls) ? row.imageUrls : [],
    url: listingId ? `https://www.ebay.com/itm/${listingId}` : undefined,
  };
}
