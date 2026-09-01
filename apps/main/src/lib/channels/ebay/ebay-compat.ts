/**
 * eBay Compatibility Layer — adapts INW/Trading data to Inventory API requirements.
 *
 * Trading GetItem uses different aspect names than Taxonomy/Inventory (e.g. Certification vs
 * Professional grader). All outbound writes must remap to Taxonomy localizedAspectName keys.
 */

import { normalizeListingAspects, parseStoredAspects, type ListingAspect } from "@/lib/listing-limits";
import type { SyncStoreItem } from "../types";
import { getItemAspectsForCategory, type EbayCategoryAspect } from "./aspects";
import { ebayGetInventoryItem } from "./client";
import {
  backfillRequiredTaxonomyAspects,
  expandGradedCoinAspectsForTaxonomy,
  fillEmptyTaxonomyAspectsFromTitle,
  fillDefaultEbayAspects,
  missingOftenRequiredEbayAspects,
  formatAspectValidationErrors,
  mergeListingAspects,
  missingEbayAspectsForListOn,
  ebayListOnFallbackAspects,
  ensureGradedCoinInventoryAspects,
  prepareAspectsForEbayCategory,
  remapAspectsToTaxonomy,
  validateRemappedAspects,
  type RemapAspectsResult,
  type ValidateRemappedAspectsResult,
} from "./aspect-prep";

export {
  EBAY_ASPECT_SYNONYMS,
  backfillRequiredTaxonomyAspects,
  expandGradedCoinAspectsForTaxonomy,
  fillEmptyTaxonomyAspectsFromTitle,
  formatAspectValidationErrors,
  mergeListingAspects,
  missingRequiredEbayAspects,
  prepareAspectsForEbayCategory,
  prepareAspectRowsForForm,
  remapAspectsToTaxonomy,
  validateRemappedAspects,
  filterSellerVisibleCategoryAspects,
  ensureGradedCoinInventoryAspects,
} from "./aspect-prep";
export type { RemapAspectsResult, ValidateRemappedAspectsResult } from "./aspect-prep";

export type EbayCategorySchema = {
  categoryId: string;
  aspects: EbayCategoryAspect[];
};

export type OutboundAspectPrep = {
  item: SyncStoreItem;
  remappedAspects: ListingAspect[];
  missingRequired: string[];
  enriched: boolean;
  categoryAspects: EbayCategoryAspect[];
  dropped: string[];
};

const schemaCache = new Map<string, { schema: EbayCategorySchema; at: number }>();
const SCHEMA_CACHE_MS = 6 * 60 * 60 * 1000;

export async function fetchCategorySchema(
  categoryId: string,
  opts?: { sellerAccessToken?: string | null }
): Promise<EbayCategorySchema> {
  const id = categoryId.trim();
  if (!id) return { categoryId: id, aspects: [] };

  const cached = schemaCache.get(id);
  const now = Date.now();
  if (cached && now - cached.at < SCHEMA_CACHE_MS) {
    return cached.schema;
  }

  const aspects = await getItemAspectsForCategory(id, {
    sellerAccessToken: opts?.sellerAccessToken,
  });
  const schema = { categoryId: id, aspects };
  schemaCache.set(id, { schema, at: now });
  return schema;
}

/** Convert Inventory API product.aspects object to ListingAspect rows. */
export function inventoryAspectsToListingAspects(
  aspects: Record<string, string[]> | undefined | null
): ListingAspect[] {
  if (!aspects) return [];
  const out: ListingAspect[] = [];
  for (const [name, values] of Object.entries(aspects)) {
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    for (const v of values ?? []) {
      const value = String(v).trim();
      if (value) out.push({ name: trimmedName, value });
    }
  }
  return normalizeListingAspects(out);
}

/**
 * Merge live inventory item aspects with INW aspects. Inventory keys are preserved;
 * non-empty remapped INW values overlay matching taxonomy keys.
 */
export function mergeAspectSources(
  inventoryAspects: ListingAspect[],
  inwAspects: ListingAspect[]
): ListingAspect[] {
  const map = new Map<string, ListingAspect>();
  for (const a of inventoryAspects) {
    map.set(a.name.toLowerCase(), { name: a.name, value: a.value });
  }
  for (const a of inwAspects) {
    const key = a.name.toLowerCase();
    const value = a.value.trim();
    if (!value) continue;
    map.set(key, { name: a.name, value });
  }
  return normalizeListingAspects(Array.from(map.values()));
}

export async function fetchInventoryAspects(
  accessToken: string,
  sku: string
): Promise<ListingAspect[]> {
  const item = await ebayGetInventoryItem(accessToken, sku);
  return inventoryAspectsToListingAspects(item?.product?.aspects);
}

export async function prepareOutboundAspects(args: {
  accessToken: string;
  sku: string;
  item: SyncStoreItem;
  categoryId: string | null;
  tradingAspects?: ListingAspect[];
  mergeFromInventory?: boolean;
}): Promise<OutboundAspectPrep> {
  let aspects = parseStoredAspects(args.item.aspects);
  const beforeKey = JSON.stringify(aspects);

  if (args.tradingAspects?.length) {
    aspects = mergeAspectSources(args.tradingAspects, aspects);
  }

  let categoryAspects: EbayCategoryAspect[] = [];
  if (args.categoryId?.trim()) {
    try {
      const schema = await fetchCategorySchema(args.categoryId, {
        sellerAccessToken: args.accessToken,
      });
      categoryAspects = schema.aspects;
    } catch {
      /* validated below if taxonomy unavailable */
    }
  }

  aspects = fillEmptyTaxonomyAspectsFromTitle(args.item.title, categoryAspects, aspects);
  aspects = expandGradedCoinAspectsForTaxonomy(categoryAspects, aspects);

  if (args.mergeFromInventory !== false && args.sku) {
    try {
      const inventoryAspects = await fetchInventoryAspects(args.accessToken, args.sku);
      aspects = mergeAspectSources(inventoryAspects, aspects);
    } catch {
      /* optional */
    }
  }

  aspects = expandGradedCoinAspectsForTaxonomy(categoryAspects, aspects);

  const remapped = remapAspectsToTaxonomy(categoryAspects, aspects);
  const backfilled = backfillRequiredTaxonomyAspects(
    categoryAspects,
    remapped.aspects,
    aspects,
    args.item.title ?? ""
  );
  const remappedAspects = fillDefaultEbayAspects(
    categoryAspects,
    ensureGradedCoinInventoryAspects(
      categoryAspects,
      backfilled,
      aspects,
      args.item.title ?? ""
    ),
    args.item.title ?? "",
    [args.item.category, args.item.subcategory, args.item.secondaryCategory].filter(
      (v): v is string => Boolean(v?.trim())
    )
  );

  const validation = validateRemappedAspects(categoryAspects, remappedAspects);
  const enriched = JSON.stringify(aspects) !== beforeKey;

  let missingRequired = [
    ...validation.missingRequired,
    ...missingOftenRequiredEbayAspects(categoryAspects, remappedAspects).filter(
      (name) => !validation.missingRequired.some((existing) => existing.toLowerCase() === name.toLowerCase())
    ),
  ];
  if (args.categoryId?.trim() && categoryAspects.length === 0) {
    const fallbackMissing = missingEbayAspectsForListOn(
      ebayListOnFallbackAspects(),
      remappedAspects
    ).filter(
      (name) => !missingRequired.some((existing) => existing.toLowerCase() === name.toLowerCase())
    );
    missingRequired = [...missingRequired, ...fallbackMissing];
  }

  const nextItem: SyncStoreItem = {
    ...args.item,
    aspects:
      categoryAspects.length > 0
        ? remappedAspects
        : remappedAspects.length > 0
          ? remappedAspects
          : args.item.aspects,
  };

  return {
    item: nextItem,
    remappedAspects,
    missingRequired,
    enriched,
    categoryAspects,
    dropped: remapped.dropped,
  };
}

/** Stable fingerprint for aspect + condition changes (sync triggers). */
export function ebayAspectsFingerprint(raw: unknown): string {
  const aspects = parseStoredAspects(raw);
  return JSON.stringify(
    aspects
      .map((a) => ({ n: a.name.toLowerCase(), v: a.value.toLowerCase() }))
      .sort((a, b) => a.n.localeCompare(b.n) || a.v.localeCompare(b.v))
  );
}

export async function validateListingForEbay(args: {
  item: Pick<SyncStoreItem, "title" | "aspects" | "ebayCategoryId" | "condition" | "ebayConditionEnum">;
  categoryId?: string | null;
}): Promise<{ valid: boolean; errors: string[] }> {
  const categoryId = args.categoryId ?? (args.item.ebayCategoryId != null ? String(args.item.ebayCategoryId) : null);
  const errors: string[] = [];

  if (!categoryId) {
    errors.push("eBay category is required.");
    return { valid: false, errors };
  }

  if (!args.item.condition) {
    errors.push("Item condition is required for eBay.");
  }

  let categoryAspects: EbayCategoryAspect[] = [];
  try {
    categoryAspects = (await fetchCategorySchema(categoryId)).aspects;
  } catch {
    errors.push("Could not load eBay category requirements. Try again or check your connection.");
    return { valid: false, errors };
  }

  const prep = prepareAspectsForEbayCategory(
    categoryAspects,
    parseStoredAspects(args.item.aspects),
    args.item.title ?? ""
  );

  if (prep.missingRequired.length > 0 || prep.invalidSelectionValues.length > 0) {
    errors.push(formatAspectValidationErrors(prep.missingRequired, prep.invalidSelectionValues));
  }

  return { valid: errors.length === 0, errors };
}
