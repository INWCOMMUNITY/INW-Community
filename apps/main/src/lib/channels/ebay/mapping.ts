import { ebayGet } from "./client";
import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import { EBAY_CURRENCY, EBAY_MARKETPLACE_ID, getEbayConfig } from "./config";
import { applyBestOfferTermsToOfferBody } from "./best-offer";
import type { EbayConnectionConfig } from "./account";
import { normalizeEbayPhotoUrl } from "./photos";
import {
  EBAY_TITLE_MAX,
  aspectsToEbayProductAspects,
  parseStoredAspects,
  type ListingAspect,
} from "@/lib/listing-limits";
import { listingDescriptionForHtmlChannel } from "../rich-description";
import { isPackageComplete } from "@/lib/package-weight";
import { listingPackageFromRemote } from "@/lib/shipping-options";

/** cents -> "12.34" (eBay expects a string decimal price). */
export function ebayPriceFromCents(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

import { resolveEbayInventoryCondition } from "./conditions";

/** Map INW condition to an eBay inventory condition enum. */
export function ebayCondition(item: Pick<SyncStoreItem, "condition" | "ebayConditionEnum">): string {
  return resolveEbayInventoryCondition(item);
}

/** Map an INW StoreItem to the Inventory API PUT body. Pass `aspectRows` when the sync pipeline already validated remapped aspects. */
export function buildEbayInventoryItem(
  item: SyncStoreItem,
  aspectRows?: ListingAspect[]
): Record<string, unknown> {
  const title = item.title.slice(0, EBAY_TITLE_MAX);
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null;

  const parsedAspects = aspectRows ?? parseStoredAspects(item.aspects);
  const storedAspects = aspectsToEbayProductAspects(parsedAspects);

  const product: Record<string, unknown> = {
    title,
    description: listingDescriptionForHtmlChannel(item.description, title),
    imageUrls: item.photos.slice(0, 12),
  };

  if (axes && axes.length > 0) {
    const primary = axes[0];
    product.aspects = { ...storedAspects, [primary.name]: primary.options.map((o) => o.value) };
  } else if (Object.keys(storedAspects).length > 0) {
    product.aspects = storedAspects;
  }

  const body: Record<string, unknown> = {
    availability: {
      shipToLocationAvailability: { quantity: Math.max(0, item.quantity) },
    },
    condition: ebayCondition(item),
    product,
  };
  if (isPackageComplete(item.package)) {
    body.packageWeightAndSize = {
      dimensions: {
        height: item.package.heightIn,
        length: item.package.lengthIn,
        width: item.package.widthIn,
        unit: "INCH",
      },
      weight: { value: item.package.weightOz, unit: "OUNCE" },
    };
  }
  return body;
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
  const fulfillmentPolicyId =
    item.package?.source === "ebay" && item.package.remoteProfileId
      ? item.package.remoteProfileId
      : cfg.fulfillmentPolicyId;
  if (fulfillmentPolicyId) listingPolicies.fulfillmentPolicyId = fulfillmentPolicyId;
  if (cfg.paymentPolicyId) listingPolicies.paymentPolicyId = cfg.paymentPolicyId;
  if (cfg.returnPolicyId) listingPolicies.returnPolicyId = cfg.returnPolicyId;
  if (Object.keys(listingPolicies).length > 0) offer.listingPolicies = listingPolicies;
  applyBestOfferTermsToOfferBody(offer, item);
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
  packageWeightAndSize?: {
    dimensions?: { height?: number; length?: number; width?: number; unit?: string };
    weight?: { value?: number; unit?: string };
  };
  remoteShippingProfileId?: string | null;
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

/** Resolve the legacy Item ID used by Trading GetItem for sync enrichment. */
export async function resolveSyncLegacyListingId(
  accessToken: string,
  args: {
    linkedSku?: string;
    sku: string;
    itemSku?: string | null;
    offerId?: string | null;
  }
): Promise<string | null> {
  for (const candidate of [args.linkedSku, args.sku, args.itemSku]) {
    if (!candidate) continue;
    const legacy = resolveEbayLegacyListingId(candidate);
    if (legacy) return legacy;
  }

  if (args.offerId?.trim()) {
    try {
      const offer = await ebayGet<{ listing?: { listingId?: string }; listingId?: string }>(
        accessToken,
        `/sell/inventory/v1/offer/${encodeURIComponent(args.offerId.trim())}`
      );
      const listingId = offer.listing?.listingId ?? offer.listingId;
      if (listingId && /^\d+$/.test(String(listingId).trim())) {
        return String(listingId).trim();
      }
    } catch {
      /* optional */
    }
  }

  return null;
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
    remoteShippingProfileId: row.remoteShippingProfileId ?? null,
    ...(() => {
      const pkg = listingPackageFromRemote({
        remoteProfileId: row.remoteShippingProfileId,
        weight: row.packageWeightAndSize?.weight?.value,
        weightUnit: row.packageWeightAndSize?.weight?.unit,
        length: row.packageWeightAndSize?.dimensions?.length,
        width: row.packageWeightAndSize?.dimensions?.width,
        height: row.packageWeightAndSize?.dimensions?.height,
        dimensionUnit: row.packageWeightAndSize?.dimensions?.unit,
      });
      return {
        packageWeightOz: pkg.weightOz,
        packageLengthIn: pkg.lengthIn,
        packageWidthIn: pkg.widthIn,
        packageHeightIn: pkg.heightIn,
      };
    })(),
  };
}
