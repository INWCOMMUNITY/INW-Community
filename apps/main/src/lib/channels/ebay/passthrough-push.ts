/**
 * Passthrough push for eBay-imported listings — preserve live Inventory API aspects verbatim.
 */

import { EBAY_TITLE_MAX } from "@/lib/listing-limits";
import { listingDescriptionForHtmlChannel } from "../rich-description";
import type { SyncStoreItem } from "../types";
import { syncContentHash, type SyncContentInput } from "../sync-baseline";
import { ebayGetInventoryItem } from "./client";
import { extractEbayInventoryAspects } from "./listing-origin";
import { enrichInventoryProductAspectsForPush, type CategoryAspectSchema } from "./aspect-prep";
import { ebayPriceFromCents } from "./mapping";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";

export type PassthroughChangedFields = {
  content: boolean;
  quantity: boolean;
  price: boolean;
};

export type LiveInventoryItem = Record<string, unknown>;

export function detectPassthroughChangedFields(
  item: SyncStoreItem,
  baseline: { syncBaselineHash?: string | null; syncBaselineQty?: number | null }
): PassthroughChangedFields {
  const contentInput: SyncContentInput = {
    title: item.title,
    description: item.description,
    priceCents: item.priceCents,
    photos: item.photos,
  };
  const hash = syncContentHash(contentInput);
  const content = (baseline.syncBaselineHash ?? "") !== hash;
  const quantity = (baseline.syncBaselineQty ?? item.quantity) !== item.quantity;
  return {
    content,
    quantity,
    price: content,
  };
}

export async function fetchLiveInventoryItem(
  accessToken: string,
  sku: string
): Promise<LiveInventoryItem | null> {
  try {
    const item = await ebayGetInventoryItem(accessToken, sku);
    return (item ?? null) as LiveInventoryItem | null;
  } catch {
    return null;
  }
}

export type PassthroughBuildOptions = {
  /** eBay leaf category taxonomy — used for category-specific wire aspect rules. */
  categoryAspects?: CategoryAspectSchema[] | null;
  /** Live inventory GET cache on the channel link. */
  cachedAspects?: Record<string, string[]> | null;
  /** INW StoreItem.aspects (Trading names like Certification). */
  storedAspects?: Record<string, string[]> | null;
  /** GetItem trading aspects — authoritative for Certification when inventory GET omits it. */
  tradingAspects?: Record<string, string[]> | null;
};

function readRawProductAspects(product: Record<string, unknown>): Record<string, string[]> {
  const aspects = product.aspects;
  if (!aspects || typeof aspects !== "object" || Array.isArray(aspects)) return {};
  const out: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(aspects as Record<string, unknown>)) {
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    if (Array.isArray(values)) {
      const arr = values.map((v) => String(v).trim()).filter(Boolean);
      if (arr.length > 0) out[trimmedName] = arr;
    } else if (values != null && String(values).trim()) {
      out[trimmedName] = [String(values).trim()];
    }
  }
  return out;
}

function mergeAspectRecords(
  ...sources: Array<Record<string, string[]> | null | undefined>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [name, values] of Object.entries(src)) {
      const trimmedName = name.trim();
      if (!trimmedName) continue;
      const key =
        Object.keys(out).find((k) => k.toLowerCase() === trimmedName.toLowerCase()) ?? trimmedName;
      if (!out[key]) out[key] = [];
      for (const v of values) {
        const val = String(v).trim();
        if (val && !out[key].includes(val)) out[key].push(val);
      }
    }
  }
  return out;
}

/**
 * Merge live eBay inventory item with INW edits. Aspects come from live eBay + silent inventory-only enrichment.
 */
export function buildPassthroughInventoryBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  changed: PassthroughChangedFields,
  options: PassthroughBuildOptions = {}
): Record<string, unknown> {
  const liveProduct =
    live.product && typeof live.product === "object"
      ? ({ ...(live.product as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const liveAspects = mergeAspectRecords(
    extractEbayInventoryAspects(live) ?? {},
    readRawProductAspects(liveProduct)
  );
  const pushAspects = enrichInventoryProductAspectsForPush(
    liveAspects,
    item.title,
    options.categoryAspects ?? [],
    options.tradingAspects,
    options.cachedAspects,
    options.storedAspects
  );
  if (Object.keys(pushAspects).length > 0) {
    liveProduct.aspects = pushAspects;
  } else {
    delete liveProduct.aspects;
  }

  if (changed.content) {
    liveProduct.title = item.title.slice(0, EBAY_TITLE_MAX);
    liveProduct.description = listingDescriptionForHtmlChannel(item.description, item.title);
    liveProduct.imageUrls = item.photos.slice(0, 12);
  }

  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null;
  if (axes && axes.length > 0) {
    const primary = axes[0];
    const variations = primary.options.map((o) => ({
      sku: `${item.id}-${o.value}`.slice(0, 50),
      aspects: { [primary.name]: [o.value] },
      availability: { shipToLocationAvailability: { quantity: Math.max(0, o.quantity) } },
    }));
    return {
      ...(typeof live.condition === "string" ? { condition: live.condition } : {}),
      product: liveProduct,
      variations,
    };
  }

  const body: Record<string, unknown> = {
    ...(typeof live.condition === "string" ? { condition: live.condition } : {}),
    product: liveProduct,
  };

  if (changed.quantity || changed.content) {
    body.availability = {
      shipToLocationAvailability: { quantity: Math.max(0, item.quantity) },
    };
  } else if (live.availability && typeof live.availability === "object") {
    body.availability = live.availability;
  }

  return body;
}

/** Overlay INW price/qty/description on an existing offer body for imported listings. */
export function buildPassthroughOfferBody(
  item: SyncStoreItem,
  changed: PassthroughChangedFields,
  baseOffer?: Record<string, unknown>
): Record<string, unknown> {
  const offer: Record<string, unknown> = baseOffer ? { ...baseOffer } : {};
  offer.availableQuantity = Math.max(0, item.quantity);

  if (changed.price) {
    offer.pricingSummary = {
      price: { value: ebayPriceFromCents(item.priceCents), currency: "USD" },
    };
  }

  if (changed.content) {
    offer.listingDescription = listingDescriptionForHtmlChannel(item.description, item.title).slice(
      0,
      500000
    );
  }

  return offer;
}
