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
import { conditionEnumFromId } from "./conditions";

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

/** Read the listing description (HTML allowed; callers sanitize for the StoreItem). */
export function parseEbayDescription(itemXml: string): string | null {
  const desc = tag(itemXml, "Description");
  if (!desc) return null;
  const decoded = decodeXmlEntities(desc).trim();
  return decoded || null;
}

/** Map eBay ConditionID / ConditionDisplayName → INW `new` | `used`. */
export function parseEbayCondition(itemXml: string): "new" | "used" | null {
  const id = (tag(itemXml, "ConditionID") ?? "").trim();
  // eBay: 1000–1750 ≈ new family; 2000+ ≈ used/refurbished
  if (id && /^\d+$/.test(id)) return Number(id) < 2000 ? "new" : "used";
  const label = (tag(itemXml, "ConditionDisplayName") ?? "").toLowerCase();
  if (!label) return null;
  if (/\bnew\b/.test(label) && !/used|pre-?owned|refurbished/.test(label)) return "new";
  if (/used|pre-?owned|refurbished|good|excellent|fair/.test(label)) return "used";
  return null;
}

/** Map eBay Trading ConditionID → Inventory API ConditionEnum when known. */
export function parseEbayConditionEnum(itemXml: string): string | null {
  const id = (tag(itemXml, "ConditionID") ?? "").trim();
  if (!id || !/^\d+$/.test(id)) return null;
  return conditionEnumFromId(Number(id));
}

export type EbayTradingBestOffer = {
  acceptOffers: boolean;
  minOfferCents: number | null;
};

function parseXmlAmountCents(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Read Best Offer enabled + minimum from GetItem Trading XML. */
export function parseEbayBestOffer(itemXml: string): EbayTradingBestOffer {
  const bestOfferDetails = tag(itemXml, "BestOfferDetails") ?? "";
  const enabledRaw =
    tag(bestOfferDetails, "BestOfferEnabled") ?? tag(itemXml, "BestOfferEnabled") ?? "";
  const acceptOffers = enabledRaw.trim().toLowerCase() === "true";
  const listingDetails = tag(itemXml, "ListingDetails") ?? "";
  const minRaw = tag(listingDetails, "MinimumBestOfferPrice");
  const minOfferCents = acceptOffers ? parseXmlAmountCents(minRaw) : null;
  return { acceptOffers, minOfferCents };
}

function firstNamedTag(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w]+:)?${name}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** Parse listing LastModifiedTime only — envelope UpdateTime is the API response clock. */
export function parseEbayLastModified(itemXml: string): Date | null {
  const raw = firstNamedTag(itemXml, "LastModifiedTime");
  if (!raw?.trim()) return null;
  const decoded = decodeXmlEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
  const d = new Date(decoded);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type EbayVariationAxis = {
  name: string;
  options: { value: string; quantity: number; sku?: string }[];
};

type ParsedVariationOption = { quantity: number; sku?: string };

/**
 * Parse single-axis Variations from GetItem XML into INW-shaped variant axes.
 * Multi-axis listings collapse onto the first VariationSpecifics name.
 */
export function parseEbayVariations(itemXml: string): EbayVariationAxis[] | null {
  const variationsBlock = tag(itemXml, "Variations");
  if (!variationsBlock) return null;
  const variationNodes = allTags(variationsBlock, "Variation");
  if (variationNodes.length === 0) return null;

  const byAxis = new Map<string, Map<string, ParsedVariationOption>>();
  for (const v of variationNodes) {
    const qtyStr = tag(v, "Quantity") ?? tag(v, "QuantityAvailable") ?? "0";
    const qty = Math.max(0, Number(qtyStr) || 0);
    const sku = tag(v, "SKU")?.trim() || undefined;
    const specifics = tag(v, "VariationSpecifics") ?? "";
    const nvls = allTags(specifics, "NameValueList");
    const primary = nvls[0];
    if (!primary) continue;
    const name = decodeXmlEntities(tag(primary, "Name") ?? "Option").trim() || "Option";
    const value = decodeXmlEntities(tag(primary, "Value") ?? "").trim();
    if (!value) continue;
    if (!byAxis.has(name)) byAxis.set(name, new Map());
    const opts = byAxis.get(name)!;
    const prev = opts.get(value);
    opts.set(value, {
      quantity: (prev?.quantity ?? 0) + qty,
      sku: prev?.sku || sku,
    });
  }

  const axes: EbayVariationAxis[] = [];
  for (const [name, opts] of byAxis) {
    axes.push({
      name: name.slice(0, 80),
      options: [...opts.entries()].map(([value, row]) => ({
        value,
        quantity: row.quantity,
        ...(row.sku ? { sku: row.sku } : {}),
      })),
    });
  }
  return axes.length > 0 ? axes : null;
}
