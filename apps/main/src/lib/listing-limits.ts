/**
 * Shared listing field limits + item-specifics (aspect) helpers.
 *
 * eBay is the most restrictive channel for several fields, so we enforce its caps everywhere
 * (API zod, the mobile + web forms, and the eBay mapper) from this single source of truth.
 * Etsy (title 140) and Wix (title 80) are still satisfied because 80 is the floor.
 *
 * eBay aspect limits per the Taxonomy API / GeteBayDetails:
 *   - aspect name  <= 40 chars
 *   - aspect value <= 50 chars
 *   - ~15-30 specifics per item (we cap at 30 to be safe)
 */

export const EBAY_TITLE_MAX = 80;
export const EBAY_ASPECT_NAME_MAX = 40;
export const EBAY_ASPECT_VALUE_MAX = 50;
export const MAX_ASPECTS = 30;

/** A single item specific (descriptor + value) as entered in the listing form. */
export type ListingAspect = {
  name: string;
  value: string;
};

/** Trim a title to the eBay-compatible max length. */
export function clampListingTitle(title: string): string {
  return title.slice(0, EBAY_TITLE_MAX);
}

/**
 * Normalize raw aspect input from a form/import into clean ListingAspect rows.
 * - drops rows with an empty name or value
 * - trims + truncates name/value to eBay caps
 * - de-dupes exact (name,value) pairs (case-insensitive) while preserving order
 * - caps the total number of rows at MAX_ASPECTS
 */
export function normalizeListingAspects(raw: unknown): ListingAspect[] {
  if (!Array.isArray(raw)) return [];
  const out: ListingAspect[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { name?: unknown; value?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, EBAY_ASPECT_NAME_MAX) : "";
    const value =
      typeof rec.value === "string" ? rec.value.trim().slice(0, EBAY_ASPECT_VALUE_MAX) : "";
    if (!name || !value) continue;

    const key = `${name.toLowerCase()}\u0000${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, value });
    if (out.length >= MAX_ASPECTS) break;
  }

  return out;
}

/**
 * Group normalized aspects into eBay's product.aspects shape: { name: [value, ...] }.
 * Multiple rows with the same descriptor become multiple values (eBay MULTI cardinality).
 */
export function aspectsToEbayProductAspects(
  aspects: ListingAspect[]
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const { name, value } of aspects) {
    if (!grouped[name]) grouped[name] = [];
    if (!grouped[name].includes(value)) grouped[name].push(value);
  }
  return grouped;
}

/** Read a StoreItem.aspects JSON column into typed rows (safe for unknown DB shapes). */
export function parseStoredAspects(raw: unknown): ListingAspect[] {
  return normalizeListingAspects(raw);
}
