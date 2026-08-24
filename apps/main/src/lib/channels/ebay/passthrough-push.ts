/**
 * Passthrough push for eBay-imported listings — preserve live Inventory API aspects verbatim.
 */

import { EBAY_TITLE_MAX } from "@/lib/listing-limits";
import { listingDescriptionForHtmlChannel } from "../rich-description";
import type { SyncStoreItem } from "../types";
import { syncContentHash, type StoreItemContentFieldFlags, type SyncContentInput } from "../sync-baseline";
import { ebayGetInventoryItem } from "./client";
import { extractEbayInventoryAspects } from "./listing-origin";
import { enrichInventoryProductAspectsForPush, prepareLiveAspectsForInventoryPut, passthroughUsePreparedInventoryAspects, type CategoryAspectSchema } from "./aspect-prep";
import { applyBestOfferTermsToOfferBody, bestOfferStatesMatch, inwBestOfferState, readOfferBestOfferTerms } from "./best-offer";
import { EBAY_CURRENCY } from "./config";
import { ebayPriceFromCents } from "./mapping";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import { normalizeInventoryImageUrls } from "./media";

export type PassthroughChangedFields = {
  content: boolean;
  quantity: boolean;
  price: boolean;
  bestOffer?: boolean;
  title?: boolean;
  photos?: boolean;
  description?: boolean;
};

/**
 * Inventory PUT rewrites all product.aspects — used for title and/or photo changes.
 * Title + photos share one PUT when both change so a photo-only overlay cannot revert title.
 * Description uses Offer PUT.
 */
export function needsInventoryPut(changed: PassthroughChangedFields): boolean {
  return changed.photos === true;
}

/** Description lives on the offer for imported listings — omit from inventory product overlay. */
function stripProductDescription(product: Record<string, unknown>): void {
  delete product.description;
}

/**
 * Re-PUT a live inventory GET with selective product/availability overlays.
 * Preserves live product.aspects verbatim (eBay Inventory PUT validates required specifics).
 */
export function buildPassthroughLiveOverlayBody(
  live: LiveInventoryItem,
  patch: {
    title?: string;
    imageUrls?: string[];
    quantity?: number;
  } = {}
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (typeof live.condition === "string") body.condition = live.condition;

  if (patch.quantity != null) {
    body.availability = {
      shipToLocationAvailability: { quantity: Math.max(0, patch.quantity) },
    };
  } else if (live.availability && typeof live.availability === "object") {
    body.availability = structuredClone(live.availability);
  }

  const liveProduct =
    live.product && typeof live.product === "object"
      ? (structuredClone(live.product) as Record<string, unknown>)
      : {};
  stripProductDescription(liveProduct);
  if (patch.title != null) {
    liveProduct.title = patch.title.slice(0, EBAY_TITLE_MAX);
  }
    if (patch.imageUrls != null) {
      const urls = normalizeInventoryImageUrls(patch.imageUrls);
      if (urls.length > 0) liveProduct.imageUrls = urls;
    } else {
      pinSanitizedLiveImageUrls(liveProduct);
    }
  body.product = liveProduct;
  return body;
}

function pinSanitizedLiveImageUrls(product: Record<string, unknown>): void {
  if (!Array.isArray(product.imageUrls)) return;
  const urls = normalizeInventoryImageUrls(product.imageUrls.map((u) => String(u)));
  if (urls.length > 0) product.imageUrls = urls;
}

/** PUT live inventory with only product.title changed — live aspects preserved. */
export function buildPassthroughTitleOnlyInventoryBody(
  live: LiveInventoryItem,
  item: SyncStoreItem
): Record<string, unknown> {
  return buildPassthroughLiveOverlayBody(live, { title: item.title });
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

/** Read offer pricingSummary.price as integer cents for drift checks. */
export function readOfferPriceCents(offer: Record<string, unknown> | null | undefined): number | null {
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
  const livePrice = readOfferPriceCents(liveOffer);
  const price = livePrice != null && livePrice !== item.priceCents;
  const liveBest = readOfferBestOfferTerms(liveOffer);
  const wantedBest = inwBestOfferState(item);
  const bestOffer = !bestOfferStatesMatch(liveBest, wantedBest);
  return {
    title,
    photos,
    description,
    quantity,
    price,
    bestOffer,
    content: title || photos || description,
  };
}

export type PassthroughSyncPrefs = {
  syncTitles: boolean;
  syncDescriptions: boolean;
  syncPhotos: boolean;
  syncPrices: boolean;
};

/**
 * Merge live eBay drift with INW edits since lastPushedHash.
 * Live comparison alone misses title/description when HTML or CDN URLs differ cosmetically.
 */
export function resolvePassthroughChanges(
  live: PassthroughChangedFields,
  inwFields: StoreItemContentFieldFlags,
  prefs: PassthroughSyncPrefs
): PassthroughChangedFields {
  const title = prefs.syncTitles && (inwFields.title || live.title);
  const description = prefs.syncDescriptions && (inwFields.description || live.description);
  const photos = prefs.syncPhotos && (inwFields.photos || live.photos);
  const price = prefs.syncPrices && (inwFields.price || live.price);
  const bestOffer = inwFields.bestOffer || live.bestOffer === true;
  return {
    title,
    photos,
    description,
    quantity: live.quantity,
    price,
    bestOffer,
    content: !!(title || photos || description),
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
  /** eBay leaf category id — wire grade rules (nickel vs dime). */
  categoryId?: string | number | null;
  /** eBay leaf category taxonomy — used for category-specific wire aspect rules. */
  categoryAspects?: CategoryAspectSchema[] | null;
  /** Live inventory GET cache on the channel link. */
  cachedAspects?: Record<string, string[]> | null;
  /** INW StoreItem.aspects (Trading names like Certification). */
  storedAspects?: Record<string, string[]> | null;
  /** GetItem trading aspects — authoritative for Certification when inventory GET omits it. */
  tradingAspects?: Record<string, string[]> | null;
  /**
   * When true, rebuild aspects from GetItem/taxonomy (live GET returned none).
   * Default: preserve live GET aspects verbatim — eBay already accepted them.
   */
  enrichAspects?: boolean;
  /** Title-only PUT: do not rewrite live wire grade fields eBay already accepted. */
  preserveLiveWireGrades?: boolean;
};

export type PassthroughFieldResult = {
  field: "price" | "quantity" | "title" | "description" | "photos" | "bestOffer";
  ok: boolean;
  error?: string;
};

/** Summarize per-field passthrough push outcomes for sync errors. */
export function formatPassthroughFieldSyncSummary(results: PassthroughFieldResult[]): string {
  if (results.length === 0) return "No fields attempted.";
  return results
    .map((r) =>
      r.ok
        ? `${r.field}: updated`
        : `${r.field}: failed (${(r.error ?? "unknown").slice(0, 400)})`
    )
    .join(". ");
}

export function passthroughSyncHasFailures(results: PassthroughFieldResult[]): boolean {
  return results.some((r) => !r.ok);
}

export function passthroughAllAttemptedFailed(results: PassthroughFieldResult[]): boolean {
  return results.length > 0 && results.every((r) => !r.ok);
}

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

/** Copy live inventory aspects exactly — do not remap or enrich. */
export function copyLiveInventoryAspects(
  liveAspects: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(liveAspects)) {
    const kept = values.map((v) => String(v).trim()).filter(Boolean);
    if (kept.length > 0) out[name] = kept;
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
  const pushAspects = prepareLiveAspectsForInventoryPut(
    liveAspects,
    item.title,
    options.categoryAspects ?? [],
    {
      preserveLiveWireGrades: options.preserveLiveWireGrades,
      categoryId: options.categoryId ?? item.ebayCategoryId ?? null,
    },
    options.tradingAspects,
    options.cachedAspects,
    options.storedAspects
  );
  if (Object.keys(pushAspects).length > 0) {
    liveProduct.aspects = pushAspects;
  } else {
    delete liveProduct.aspects;
  }

  const overlayPhotos = changed.photos === true;
  // Always pin INW title. Inventory GET lags a Trading revise; omitting title
  // re-sends the old title and the next GetItem copies it back onto INW.
  liveProduct.title = item.title.slice(0, EBAY_TITLE_MAX);
  if (overlayPhotos) {
    liveProduct.imageUrls = normalizeInventoryImageUrls(item.photos);
  } else {
    pinSanitizedLiveImageUrls(liveProduct);
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

/** Inventory PUT for title-only edits — aspect-safe body with GetItem/taxonomy fallbacks. */
export function buildPassthroughTitleInventoryBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  options: PassthroughBuildOptions = {}
): Record<string, unknown> {
  return buildPassthroughInventoryBody(
    live,
    item,
    { title: true, content: false, quantity: false, price: false, photos: false },
    { ...options, preserveLiveWireGrades: options.preserveLiveWireGrades ?? true }
  );
}

/** Single inventory PUT for title and/or photo overlays — avoids a second PUT clobbering title. */
export function buildPassthroughInventoryContentPutBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  overlays: { title?: boolean; photos?: boolean },
  usePrepared: boolean,
  options: PassthroughBuildOptions = {}
): { body: Record<string, unknown>; aspectMode: "prepared" | "live_overlay" } {
  const pushTitle = overlays.title === true;
  const pushPhotos = overlays.photos === true;
  if (usePrepared) {
    return {
      body: buildPassthroughInventoryBody(
        live,
        item,
        { title: pushTitle || pushPhotos, photos: pushPhotos, content: false, quantity: false, price: false },
        { ...options, preserveLiveWireGrades: false }
      ),
      aspectMode: "prepared",
    };
  }
  const patch: { title?: string; imageUrls?: string[] } = {};
  if (pushTitle || pushPhotos) patch.title = item.title;
  if (pushPhotos) patch.imageUrls = item.photos;
  return {
    body: buildPassthroughLiveOverlayBody(live, patch),
    aspectMode: "live_overlay",
  };
}

export function buildPassthroughTitlePutBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  usePrepared: boolean,
  options: PassthroughBuildOptions = {}
): { body: Record<string, unknown>; aspectMode: "prepared" | "live_overlay" } {
  return buildPassthroughInventoryContentPutBody(live, item, { title: true }, usePrepared, options);
}

export function buildPassthroughPhotosPutBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  usePrepared: boolean,
  options: PassthroughBuildOptions = {}
): { body: Record<string, unknown>; aspectMode: "prepared" | "live_overlay" } {
  return buildPassthroughInventoryContentPutBody(live, item, { photos: true }, usePrepared, options);
}

/** Inventory PUT for photo-only edits — aspect-safe body with GetItem/taxonomy fallbacks. */
export function buildPassthroughPhotoInventoryBody(
  live: LiveInventoryItem,
  item: SyncStoreItem,
  options: PassthroughBuildOptions = {}
): Record<string, unknown> {
  return buildPassthroughInventoryBody(
    live,
    item,
    { photos: true, content: false, quantity: false, price: false, title: false },
    { ...options, preserveLiveWireGrades: true }
  );
}

const OFFER_READ_ONLY_KEYS = new Set([
  "offerId",
  "status",
  "listing",
  "listingId",
  "soldQuantity",
  "href",
  /** Inventory item owns conditionDescriptors — copying stale offer values triggers #25069. */
  "conditionDescriptors",
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
      price: { value: ebayPriceFromCents(item.priceCents), currency: EBAY_CURRENCY },
    };
  }

  if (changed.description || (changed.content && changed.description == null)) {
    offer.listingDescription = listingDescriptionForHtmlChannel(item.description, item.title).slice(
      0,
      500000
    );
  }

  if (changed.bestOffer) {
    applyBestOfferTermsToOfferBody(offer, item);
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
      price: { value: ebayPriceFromCents(item.priceCents), currency: EBAY_CURRENCY },
    };
  }

  if (changed.description || changed.content) {
    offer.listingDescription = listingDescriptionForHtmlChannel(item.description, item.title).slice(
      0,
      500000
    );
  }

  if (changed.bestOffer) {
    applyBestOfferTermsToOfferBody(offer, item);
  }

  return offer;
}

function aspectValues(aspects: Record<string, string[]>, name: string): string {
  const key = Object.keys(aspects).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return "(missing)";
  const vals = aspects[key]?.map((v) => v.trim()).filter(Boolean);
  return vals.length > 0 ? vals.join(",") : "(empty)";
}

export function formatPushedAspectsSummary(aspects: Record<string, string[]> | null | undefined): string {
  if (!aspects || Object.keys(aspects).length === 0) return "Sent aspects: (none)";
  const keys = Object.keys(aspects);
  const grader =
    aspectValues(aspects, "Professional grader") !== "(missing)"
      ? aspectValues(aspects, "Professional grader")
      : aspectValues(aspects, "Certification");
  const letter = aspectValues(aspects, "Letter grade");
  const numerical = aspectValues(aspects, "Numerical grade");
  const keyDetails = keys
    .map((k) => `${k}=${aspectValues(aspects, k)}`)
    .join("; ");
  return `Sent aspects (prepared): ${keys.join(", ")}. ${keyDetails}. Grader=${grader}; Letter grade=${letter}; Numerical grade=${numerical}`;
}

export function formatPassthroughPutNote(
  body: Record<string, unknown> | null | undefined
): string {
  const product = body?.product;
  if (!product || typeof product !== "object") return "Inventory PUT: aspects omitted.";
  const aspects = (product as Record<string, unknown>).aspects;
  if (aspects != null) {
    return formatPushedAspectsSummary(aspects as Record<string, string[]>);
  }
  return "Inventory PUT: live aspects preserved verbatim from eBay GET.";
}
