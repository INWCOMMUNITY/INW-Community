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
  title?: boolean;
  photos?: boolean;
  description?: boolean;
};

/** Inventory PUT is only required when title or photos change (full product replace). */
export function needsInventoryPut(changed: PassthroughChangedFields): boolean {
  if (changed.title === true || changed.photos === true) return true;
  if (changed.title === false && changed.photos === false) return false;
  return changed.content;
}

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

function normalizeCompareText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePhotoUrl(url: string): string {
  return url
    .trim()
    .replace(/\?.*$/, "")
    .replace(/\/s-l\d+(\.\w+)?$/i, "")
    .replace(/\/\$\d+\.\w+$/i, "")
    .toLowerCase();
}

function photosMatch(live: string[], inw: string[]): boolean {
  const a = live.map(normalizePhotoUrl).filter(Boolean);
  const b = inw.map(normalizePhotoUrl).filter(Boolean);
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const setA = new Set(a);
  return b.every((url) => setA.has(url));
}

function liveQuantity(live: LiveInventoryItem): number | null {
  const availability = live.availability;
  if (!availability || typeof availability !== "object") return null;
  const ship = (availability as { shipToLocationAvailability?: { quantity?: unknown } })
    .shipToLocationAvailability;
  if (ship?.quantity == null) return null;
  const n = Number(ship.quantity);
  return Number.isFinite(n) ? n : null;
}

function offerPriceCents(offer: Record<string, unknown> | null | undefined): number | null {
  const summary = offer?.pricingSummary;
  if (!summary || typeof summary !== "object") return null;
  const price = (summary as { price?: { value?: unknown } }).price;
  if (price?.value == null) return null;
  const n = Number(price.value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function offerDescription(offer: Record<string, unknown> | null | undefined): string {
  const raw = offer?.listingDescription;
  return typeof raw === "string" ? raw : "";
}

/** Compare INW fields to live eBay inventory + offer so we only rewrite what changed. */
export function detectLivePassthroughChanges(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  liveOffer?: Record<string, unknown> | null
): PassthroughChangedFields {
  const product =
    live.product && typeof live.product === "object"
      ? (live.product as Record<string, unknown>)
      : {};
  const liveTitle = typeof product.title === "string" ? product.title : "";
  const livePhotos = Array.isArray(product.imageUrls)
    ? product.imageUrls.map((u) => String(u))
    : [];
  const title = normalizeCompareText(liveTitle) !== normalizeCompareText(item.title.slice(0, EBAY_TITLE_MAX));
  const photos = !photosMatch(livePhotos.slice(0, 12), item.photos.slice(0, 12));
  const wantedDescription = listingDescriptionForHtmlChannel(item.description, item.title);
  const liveDesc = offerDescription(liveOffer) || (typeof product.description === "string" ? product.description : "");
  const description = normalizeCompareText(liveDesc) !== normalizeCompareText(wantedDescription);
  const liveQty = liveQuantity(live);
  const quantity = liveQty != null && liveQty !== Math.max(0, item.quantity);
  const livePrice = offerPriceCents(liveOffer);
  const price = livePrice != null && livePrice !== item.priceCents;
  return {
    title,
    photos,
    description,
    quantity,
    price,
    content: title || photos || description,
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

  const overlayTitle = changed.title ?? changed.content;
  const overlayPhotos = changed.photos ?? changed.content;
  if (overlayTitle) {
    liveProduct.title = item.title.slice(0, EBAY_TITLE_MAX);
  }
  if (overlayPhotos) {
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

const OFFER_READ_ONLY_KEYS = new Set([
  "offerId",
  "status",
  "listing",
  "listingId",
  "soldQuantity",
  "href",
]);

/** Overlay INW description/qty on a live GET offer — never rewrite category or policies. */
export function overlayPassthroughOffer(
  liveOffer: Record<string, unknown>,
  item: SyncStoreItem,
  changed: PassthroughChangedFields
): Record<string, unknown> {
  const offer: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(liveOffer)) {
    if (OFFER_READ_ONLY_KEYS.has(key)) continue;
    offer[key] = value;
  }

  if (changed.quantity) {
    offer.availableQuantity = Math.max(0, item.quantity);
  }

  if (changed.price) {
    const existing =
      offer.pricingSummary && typeof offer.pricingSummary === "object"
        ? { ...(offer.pricingSummary as Record<string, unknown>) }
        : {};
    offer.pricingSummary = {
      ...existing,
      price: { value: ebayPriceFromCents(item.priceCents), currency: "USD" },
    };
  }

  if (changed.description || (changed.content && changed.description == null)) {
    offer.listingDescription = listingDescriptionForHtmlChannel(item.description, item.title).slice(
      0,
      500000
    );
  }

  return offer;
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

  if (changed.description || changed.content) {
    offer.listingDescription = listingDescriptionForHtmlChannel(item.description, item.title).slice(
      0,
      500000
    );
  }

  return offer;
}

export function formatPushedAspectsSummary(aspects: Record<string, string[]> | null | undefined): string {
  if (!aspects || Object.keys(aspects).length === 0) return "Sent aspects: (none)";
  const keys = Object.keys(aspects);
  const grader = aspects["Professional grader"]?.join(",") ?? "(missing)";
  const letter = aspects["Letter grade"]?.join(",") ?? "(missing)";
  const numerical = aspects["Numerical grade"]?.join(",") ?? "(missing)";
  return `Sent aspects: ${keys.join(", ")}. Professional grader=${grader}; Letter grade=${letter}; Numerical grade=${numerical}`;
}
