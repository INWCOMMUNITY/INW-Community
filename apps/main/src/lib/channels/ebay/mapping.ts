import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import { EBAY_CURRENCY, EBAY_MARKETPLACE_ID, getEbayConfig } from "./config";
import type { EbayConnectionConfig } from "./account";
import { normalizeEbayPhotoUrl } from "./photos";
import {
  EBAY_TITLE_MAX,
  aspectsToEbayProductAspects,
  parseStoredAspects,
} from "@/lib/listing-limits";
import { listingDescriptionForHtmlChannel } from "../rich-description";

/** cents -> "12.34" (eBay expects a string decimal price). */
export function ebayPriceFromCents(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

import { resolveEbayInventoryCondition } from "./conditions";

/** Map INW condition to an eBay inventory condition enum. */
export function ebayCondition(item: Pick<SyncStoreItem, "condition" | "ebayConditionEnum">): string {
  return resolveEbayInventoryCondition(item);
}

/** Build the PUT /inventory_item/{sku} body for a StoreItem. */
export function buildEbayInventoryItem(item: SyncStoreItem): Record<string, unknown> {
  const title = item.title.slice(0, EBAY_TITLE_MAX);
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null;

  // Seller-entered item specifics (Brand/Type/Size/...) — required by most eBay categories.
  const parsedAspects = parseStoredAspects(item.aspects);
  const storedAspects = aspectsToEbayProductAspects(parsedAspects);

  const product: Record<string, unknown> = {
    title,
    description: listingDescriptionForHtmlChannel(item.description, title),
    imageUrls: item.photos.slice(0, 12),
  };

  if (axes && axes.length > 0) {
    const primary = axes[0];
    const baseSku = getEffectiveSku(item);
    // Variant axis values join the stored specifics; the axis name wins if both are present.
    product.aspects = { ...storedAspects, [primary.name]: primary.options.map((o) => o.value) };
    const variations = primary.options.map((o) => ({
      sku: `${baseSku}-${o.value}`.slice(0, 50),
      aspects: { [primary.name]: [o.value] },
      availability: { shipToLocationAvailability: { quantity: Math.max(0, o.quantity) } },
    }));
    return {
      condition: ebayCondition(item),
      product,
      variations,
    };
  }

  if (Object.keys(storedAspects).length > 0) {
    product.aspects = storedAspects;
  }

  return {
    availability: {
      shipToLocationAvailability: { quantity: Math.max(0, item.quantity) },
    },
    condition: ebayCondition(item),
    product,
  };
}

/** Resolve the eBay leaf category for an item (per-item eBay category wins over INW category map). */
export function resolveCategoryId(item: SyncStoreItem, overrideId?: string | null): string | null {
  if (item.ebayCategoryId != null) return String(item.ebayCategoryId);
  if (overrideId) return overrideId;
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
  cfg: EbayConnectionConfig,
  categoryOverride?: string | null,
  sku?: string
): Record<string, unknown> {
  const categoryId = resolveCategoryId(item, categoryOverride);
  const offer: Record<string, unknown> = {
    sku: sku || getEffectiveSku(item),
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    availableQuantity: Math.max(0, item.quantity),
    listingDescription: listingDescriptionForHtmlChannel(item.description, item.title).slice(
      0,
      500000
    ),
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
  /** eBay leaf category id + name (from the Trading API PrimaryCategory). */
  categoryId?: string | null;
  categoryName?: string | null;
  remoteUpdatedAt?: Date | null;
  description?: string | null;
  variants?: unknown;
  variantsKnown?: boolean;
};

function priceStringToCents(value?: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Numeric eBay Item ID from a preview id, INW SKU (`inw123…`), or plain legacy id. */
export function resolveEbayLegacyListingId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const inw = trimmed.match(/^inw(\d+)$/i);
  return inw ? inw[1]! : null;
}

/**
 * Lookup map for reconcile and repair: index by legacy Item ID, INW SKU, and link ids.
 * Channel links store the migrated SKU (`inw…`); preview/import use numeric Item IDs.
 */
export function indexEbayRemoteListings(
  listings: RemoteListingSummary[]
): Map<string, RemoteListingSummary> {
  const map = new Map<string, RemoteListingSummary>();
  for (const listing of listings) {
    map.set(listing.externalListingId, listing);
    if (listing.sku) map.set(listing.sku, listing);
    const legacy = resolveEbayLegacyListingId(listing.externalListingId);
    if (legacy) {
      map.set(legacy, listing);
      map.set(`inw${legacy}`, listing);
    }
  }
  return map;
}

export function findEbayRemoteListing(
  listings: RemoteListingSummary[],
  linkExternalListingId: string
): RemoteListingSummary | undefined {
  return indexEbayRemoteListings(listings).get(linkExternalListingId);
}

/** Map an eBay inventory/offer summary row to a provider-agnostic import preview entry. */
export function ebayListingToSummary(row: EbayInventorySummaryRow): RemoteListingSummary {
  const listingId = row.listingId || row.listing?.listingId;
  const legacyId =
    listingId && /^\d+$/.test(listingId.trim()) ? listingId.trim() : null;
  // Import/migrate require the numeric Item ID; INW SKU lives on `sku` for reconcile lookups.
  const externalListingId = legacyId || row.offerId || row.sku?.trim() || "";
  return {
    externalListingId,
    title: row.title || "eBay listing",
    sku: row.sku?.trim() || null,
    description: row.description ?? null,
    priceCents: priceStringToCents(row.price?.value),
    quantity: Math.max(0, row.availableQuantity ?? 0),
    quantityKnown: row.availableQuantity != null,
    photos: Array.isArray(row.imageUrls)
      ? row.imageUrls
          .map((u) => normalizeEbayPhotoUrl(u))
          .filter((u): u is string => Boolean(u))
      : [],
    url: listingId ? `https://www.ebay.com/itm/${listingId}` : undefined,
    remoteUpdatedAt: row.remoteUpdatedAt ?? null,
    category: row.categoryName ?? null,
    remoteCategoryId: row.categoryId ?? null,
    variants: row.variants,
    variantsKnown: row.variantsKnown === true,
    shippingKnown: false,
  };
}
