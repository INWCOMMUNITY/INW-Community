/**
 * Passthrough push for eBay-imported listings — preserve live Inventory API aspects verbatim.
 */

import { EBAY_TITLE_MAX } from "@/lib/listing-limits";
import { listingDescriptionForHtmlChannel } from "../rich-description";
import type { SyncStoreItem } from "../types";
import { syncContentHash, type SyncContentInput } from "../sync-baseline";
import { ebayGetInventoryItem } from "./client";
import { extractEbayInventoryAspects } from "./listing-origin";
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

/**
 * Merge live eBay inventory item with INW edits. Aspects always come from live eBay.
 */
export function buildPassthroughInventoryBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  changed: PassthroughChangedFields
): Record<string, unknown> {
  const liveProduct =
    live.product && typeof live.product === "object"
      ? ({ ...(live.product as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const liveAspects = extractEbayInventoryAspects(live);
  if (liveAspects && Object.keys(liveAspects).length > 0) {
    liveProduct.aspects = liveAspects;
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
