/**
 * Parse eBay Trading API GetItem XML for the fields we round-trip on import:
 * item specifics (aspects), the primary category, and the listing description.
 *
 * These are kept pure (string XML in, plain data out) so they can be unit tested without
 * hitting eBay, and reused by `trading.ts` enrichment.
 */

import { tag, allTags, decodeXmlEntities } from "./photos";
import {
  EBAY_ASPECT_NAME_MAX,
  EBAY_ASPECT_VALUE_MAX,
  MAX_ASPECTS,
  type ListingAspect,
} from "@/lib/listing-limits";

/**
 * Parse `<ItemSpecifics><NameValueList><Name>..</Name><Value>..</Value>..` into aspect rows.
 * A NameValueList may carry multiple <Value> tags (eBay MULTI); each becomes its own row.
 */
export function parseEbayItemSpecifics(itemXml: string): ListingAspect[] {
  const specifics = tag(itemXml, "ItemSpecifics");
  if (!specifics) return [];

  const out: ListingAspect[] = [];
  const seen = new Set<string>();
  for (const nvl of allTags(specifics, "NameValueList")) {
    const rawName = tag(nvl, "Name");
    if (!rawName) continue;
    const name = decodeXmlEntities(rawName).trim().slice(0, EBAY_ASPECT_NAME_MAX);
    if (!name) continue;
    for (const rawValue of allTags(nvl, "Value")) {
      const value = decodeXmlEntities(rawValue).trim().slice(0, EBAY_ASPECT_VALUE_MAX);
      if (!value) continue;
      const key = `${name.toLowerCase()}\u0000${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, value });
      if (out.length >= MAX_ASPECTS) return out;
    }
  }
  return out;
}

export type EbayPrimaryCategory = { categoryId: string | null; categoryName: string | null };

/** Read `<PrimaryCategory><CategoryID>..</CategoryID><CategoryName>..</CategoryName>`. */
export function parseEbayPrimaryCategory(itemXml: string): EbayPrimaryCategory {
  const primary = tag(itemXml, "PrimaryCategory");
  if (!primary) return { categoryId: null, categoryName: null };
  const id = tag(primary, "CategoryID");
  const name = tag(primary, "CategoryName");
  return {
    categoryId: id ? id.trim() : null,
    categoryName: name ? decodeXmlEntities(name).trim() : null,
  };
}

/** Read the listing description (HTML allowed; callers strip it for the StoreItem). */
export function parseEbayDescription(itemXml: string): string | null {
  const desc = tag(itemXml, "Description");
  if (!desc) return null;
  const decoded = decodeXmlEntities(desc).trim();
  return decoded || null;
}
