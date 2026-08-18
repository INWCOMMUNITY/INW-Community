/**
 * eBay Compatibility Layer — adapts INW/Trading data to Inventory API requirements.
 *
 * Trading GetItem uses different aspect names than Taxonomy/Inventory (e.g. Certification vs
 * Professional grader). All outbound writes must remap to Taxonomy localizedAspectName keys.
 */

import {
  normalizeListingAspects,
  parseStoredAspects,
  type ListingAspect,
} from "@/lib/listing-limits";
import type { SyncStoreItem } from "../types";
import { getItemAspectsForCategory, type EbayCategoryAspect } from "./aspects";
import { ebayGetInventoryItem } from "./client";
import { fetchEbayCategoryConditions } from "./conditions";

export function mergeListingAspects(base: ListingAspect[], extra: ListingAspect[]): ListingAspect[] {
  const map = new Map<string, ListingAspect>();
  for (const a of base) {
    const key = a.name.trim().toLowerCase();
    if (!key) continue;
    map.set(key, { name: a.name.trim(), value: a.value.trim() });
  }
  for (const a of extra) {
    const key = a.name.trim().toLowerCase();
    const value = a.value.trim();
    if (!key || !value) continue;
    const existing = map.get(key);
    if (!existing?.value) {
      map.set(key, { name: a.name.trim(), value });
    }
  }
  return normalizeListingAspects(Array.from(map.values()));
}

/** Trading/import aliases → Taxonomy aspect name (case resolved against category schema). */
export const EBAY_ASPECT_SYNONYMS: Record<string, string[]> = {
  "professional grader": ["certification", "certification service", "grader", "professional grader"],
  grade: ["grade"],
  "letter grade": ["letter grade"],
  "numerical grade": ["numerical grade", "numeric grade"],
  "certification number": ["certification number", "cert number", "cert #"],
  year: ["year", "year of issue", "year of manufacture"],
  mint: ["mint", "mint location"],
  "strike type": ["strike type"],
  denomination: ["denomination"],
  country: ["country", "country of origin"],
  composition: ["composition", "material"],
  coin: ["coin"],
  "circulated/uncirculated": ["circulated/uncirculated", "circulated", "uncirculated"],
};

export type EbayCategorySchema = {
  categoryId: string;
  aspects: EbayCategoryAspect[];
};

export type RemapAspectsResult = {
  aspects: ListingAspect[];
  /** Aspects dropped because they don't exist in taxonomy for this category. */
  dropped: string[];
  /** Values adjusted to match SELECTION_ONLY allowed values. */
  valueAdjustments: { name: string; from: string; to: string }[];
};

export type OutboundAspectPrep = {
  item: SyncStoreItem;
  remappedAspects: ListingAspect[];
  missingRequired: string[];
  enriched: boolean;
  categoryAspects: EbayCategoryAspect[];
  dropped: string[];
};

const YEAR_SOURCE_NAMES = new Set(["year", "year of issue", "year of manufacture"]);

function extractYearValue(sources: ListingAspect[], title: string): string | null {
  for (const a of sources) {
    if (YEAR_SOURCE_NAMES.has(a.name.trim().toLowerCase()) && a.value.trim()) {
      return a.value.trim();
    }
  }
  const match = title.trim().match(/\b((?:18|19|20)\d{2})(?:-[A-Z]{1,3})?\b/);
  return match?.[1] ?? null;
}

/**
 * After taxonomy remap, restore required fields from pre-remap sources (title patterns,
 * Trading import names, etc.) so a successful remap pass does not drop Year and other
 * required specifics that were present under a different key.
 */
export function backfillRequiredTaxonomyAspects(
  categoryAspects: EbayCategoryAspect[],
  remappedAspects: ListingAspect[],
  sources: ListingAspect[],
  title: string
): ListingAspect[] {
  if (categoryAspects.length === 0) return remappedAspects;

  const out = new Map(remappedAspects.map((a) => [a.name.toLowerCase(), a]));
  const missing = missingRequiredEbayAspects(categoryAspects, remappedAspects);

  for (const req of missing) {
    const reqLower = req.toLowerCase();
    if (!reqLower.includes("year")) continue;

    const yearVal = extractYearValue(sources, title);
    if (!yearVal) continue;

    const yearName = findCategoryAspectName(categoryAspects, [
      req,
      "Year",
      "Year of Issue",
      "Year of Manufacture",
    ]);
    if (!yearName || out.get(yearName.toLowerCase())?.value.trim()) continue;
    out.set(yearName.toLowerCase(), { name: yearName, value: yearVal });
  }

  // Retry remap for any source rows that may fill remaining required fields.
  const retryRemap = remapAspectsToTaxonomy(categoryAspects, [
    ...sources,
    ...normalizeListingAspects(Array.from(out.values())),
  ]);
  for (const a of retryRemap.aspects) {
    out.set(a.name.toLowerCase(), a);
  }

  return normalizeListingAspects(Array.from(out.values()));
}

const schemaCache = new Map<string, { schema: EbayCategorySchema; at: number }>();
const SCHEMA_CACHE_MS = 6 * 60 * 60 * 1000;

export async function fetchCategorySchema(categoryId: string): Promise<EbayCategorySchema> {
  const id = categoryId.trim();
  if (!id) return { categoryId: id, aspects: [] };

  const cached = schemaCache.get(id);
  const now = Date.now();
  if (cached && now - cached.at < SCHEMA_CACHE_MS) {
    return cached.schema;
  }

  const aspects = await getItemAspectsForCategory(id);
  const schema = { categoryId: id, aspects };
  schemaCache.set(id, { schema, at: now });
  return schema;
}

function buildTaxonomyNameLookup(categoryAspects: EbayCategoryAspect[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const aspect of categoryAspects) {
    lookup.set(aspect.name.toLowerCase(), aspect.name);
  }
  return lookup;
}

function resolveSynonymTarget(
  aliasLower: string,
  taxonomyLookup: Map<string, string>
): string | null {
  for (const [canonicalLower, aliases] of Object.entries(EBAY_ASPECT_SYNONYMS)) {
    if (!aliases.includes(aliasLower) && canonicalLower !== aliasLower) continue;

    // Try canonical taxonomy name (e.g. "professional grader")
    const canonicalHit = taxonomyLookup.get(canonicalLower);
    if (canonicalHit) return canonicalHit;

    // Try every alias against taxonomy (e.g. "country of origin" when canonical is "country")
    for (const alias of aliases) {
      const byAlias = taxonomyLookup.get(alias);
      if (byAlias) return byAlias;
    }
  }
  return null;
}

function normalizeSelectionValue(
  aspect: EbayCategoryAspect,
  value: string
): { value: string; adjusted: boolean } {
  const trimmed = value.trim();
  if (aspect.mode !== "SELECTION_ONLY" || aspect.suggestedValues.length === 0) {
    return { value: trimmed, adjusted: false };
  }
  const exact = aspect.suggestedValues.find((v) => v === trimmed);
  if (exact) return { value: exact, adjusted: false };
  const ci = aspect.suggestedValues.find((v) => v.toLowerCase() === trimmed.toLowerCase());
  if (ci) return { value: ci, adjusted: true };
  return { value: trimmed, adjusted: false };
}

/**
 * Remap stored/Trading aspect names to exact Taxonomy localizedAspectName keys.
 */
export function remapAspectsToTaxonomy(
  categoryAspects: EbayCategoryAspect[],
  aspects: ListingAspect[]
): RemapAspectsResult {
  const taxonomyLookup = buildTaxonomyNameLookup(categoryAspects);
  const valueAdjustments: RemapAspectsResult["valueAdjustments"] = [];
  const dropped: string[] = [];
  const aspectByCanonical = new Map<string, ListingAspect>();

  for (const raw of aspects) {
    const nameLower = raw.name.trim().toLowerCase();
    const value = raw.value.trim();
    if (!nameLower || !value) continue;

    let canonicalName = taxonomyLookup.get(nameLower) ?? resolveSynonymTarget(nameLower, taxonomyLookup);

    if (!canonicalName) {
      dropped.push(raw.name.trim());
      continue;
    }

    const schema = categoryAspects.find((a) => a.name === canonicalName);
    let finalValue = value;
    if (schema) {
      const normalized = normalizeSelectionValue(schema, value);
      finalValue = normalized.value;
      if (normalized.adjusted) {
        valueAdjustments.push({ name: canonicalName, from: value, to: finalValue });
      }
    }

    const existing = aspectByCanonical.get(canonicalName.toLowerCase());
    if (!existing?.value) {
      aspectByCanonical.set(canonicalName.toLowerCase(), { name: canonicalName, value: finalValue });
    }
  }

  return {
    aspects: normalizeListingAspects(Array.from(aspectByCanonical.values())),
    dropped,
    valueAdjustments,
  };
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

function findCategoryAspectName(
  categoryAspects: EbayCategoryAspect[],
  candidates: string[]
): string | null {
  const byLower = new Map(categoryAspects.map((a) => [a.name.toLowerCase(), a.name]));
  for (const c of candidates) {
    const hit = byLower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Fill empty taxonomy fields from coin title patterns (NGC MS 67, etc.).
 * Only uses canonical taxonomy names — no hardcoded wrong-cased keys.
 */
export function fillEmptyTaxonomyAspectsFromTitle(
  title: string,
  categoryAspects: EbayCategoryAspect[],
  existing: ListingAspect[] = []
): ListingAspect[] {
  const filled = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
  const t = title.trim();
  if (!t || categoryAspects.length === 0) return existing;

  const hasValue = (name: string) => !!filled.get(name.toLowerCase())?.value.trim();

  const graderMatch = t.match(/\b(NGC|PCGS|ANACS|ICG|PMG|CACG)\b/i);
  if (graderMatch) {
    const graderName = findCategoryAspectName(categoryAspects, ["Professional grader"]);
    if (graderName && !hasValue(graderName)) {
      filled.set(graderName.toLowerCase(), {
        name: graderName,
        value: graderMatch[1]!.toUpperCase(),
      });
    }
  }

  const yearMatch = t.match(/\b((?:18|19|20)\d{2})(?:-[A-Z]{1,3})?\b/);
  if (yearMatch) {
    const yearName = findCategoryAspectName(categoryAspects, [
      "Year",
      "Year of Issue",
      "Year of Manufacture",
    ]);
    if (yearName && !hasValue(yearName)) {
      filled.set(yearName.toLowerCase(), { name: yearName, value: yearMatch[1]! });
    }
  }

  const gradeMatch = t.match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
  if (gradeMatch) {
    const gradeName = findCategoryAspectName(categoryAspects, ["Grade"]);
    const gradeLabel = `${gradeMatch[1]!.toUpperCase()} ${gradeMatch[2]}`;
    const numericValue = gradeMatch[2]!;

    if (gradeName && !hasValue(gradeName)) {
      filled.set(gradeName.toLowerCase(), { name: gradeName, value: gradeLabel });
    }

    const letterName = findCategoryAspectName(categoryAspects, ["Letter grade"]);
    if (letterName && !hasValue(letterName)) {
      filled.set(letterName.toLowerCase(), { name: letterName, value: numericValue });
    }

    const numericalName = findCategoryAspectName(categoryAspects, ["Numerical grade"]);
    if (numericalName && !hasValue(numericalName)) {
      filled.set(numericalName.toLowerCase(), { name: numericalName, value: numericValue });
    }
  }

  return normalizeListingAspects(Array.from(filled.values()));
}

function parseCoinGradeLabel(value: string): { label: string; numeric: string } | null {
  const m = value.trim().match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
  if (!m) return null;
  return { label: `${m[1]!.toUpperCase()} ${m[2]!}`, numeric: m[2]! };
}

const GRADER_SOURCE_NAMES = new Set([
  "certification",
  "certification service",
  "professional grader",
  "grader",
  "professional grader (certification service)",
]);

/**
 * Derive Letter grade / Numerical grade / Professional grader from Trading-style
 * Grade and Certification values (e.g. Grade "MS 67" + Certification "NGC").
 */
export function expandGradedCoinAspectsForTaxonomy(
  categoryAspects: EbayCategoryAspect[],
  aspects: ListingAspect[]
): ListingAspect[] {
  if (categoryAspects.length === 0) return aspects;

  const filled = new Map<string, ListingAspect>();
  for (const a of aspects) {
    const key = a.name.trim().toLowerCase();
    if (!key) continue;
    filled.set(key, { name: a.name.trim(), value: a.value.trim() });
  }

  const hasValue = (name: string) => !!filled.get(name.toLowerCase())?.value.trim();

  let gradeLabel: string | null = null;
  let numericGrade: string | null = null;

  for (const a of aspects) {
    const parsed = parseCoinGradeLabel(a.value);
    if (parsed) {
      gradeLabel = gradeLabel ?? parsed.label;
      numericGrade = numericGrade ?? parsed.numeric;
    }
  }

  for (const a of aspects) {
    if (!GRADER_SOURCE_NAMES.has(a.name.trim().toLowerCase())) continue;
    const value = a.value.trim();
    if (!value) continue;
    const proName = findCategoryAspectName(categoryAspects, ["Professional grader"]);
    if (proName && !hasValue(proName)) {
      filled.set(proName.toLowerCase(), { name: proName, value: value.toUpperCase() });
    }
  }

  if (numericGrade) {
    const letterName = findCategoryAspectName(categoryAspects, ["Letter grade"]);
    if (letterName && !hasValue(letterName)) {
      filled.set(letterName.toLowerCase(), { name: letterName, value: numericGrade });
    }
    const numericalName = findCategoryAspectName(categoryAspects, ["Numerical grade"]);
    if (numericalName && !hasValue(numericalName)) {
      filled.set(numericalName.toLowerCase(), { name: numericalName, value: numericGrade });
    }
  }

  if (gradeLabel) {
    const gradeName = findCategoryAspectName(categoryAspects, ["Grade"]);
    if (gradeName && !hasValue(gradeName)) {
      filled.set(gradeName.toLowerCase(), { name: gradeName, value: gradeLabel });
    }
  }

  return normalizeListingAspects(Array.from(filled.values()));
}

export function missingRequiredEbayAspects(
  categoryAspects: EbayCategoryAspect[],
  aspects: ListingAspect[]
): string[] {
  const aspectMap = new Map(aspects.map((a) => [a.name.toLowerCase(), a.value.trim()]));
  const missing: string[] = [];
  for (const aspect of categoryAspects) {
    if (!aspect.required) continue;
    const value = aspectMap.get(aspect.name.toLowerCase());
    if (!value?.trim()) missing.push(aspect.name);
  }
  return missing;
}

export type ValidateRemappedAspectsResult = {
  valid: boolean;
  missingRequired: string[];
  invalidSelectionValues: { name: string; value: string; allowed: string[] }[];
};

export function validateRemappedAspects(
  categoryAspects: EbayCategoryAspect[],
  aspects: ListingAspect[]
): ValidateRemappedAspectsResult {
  const aspectMap = new Map(aspects.map((a) => [a.name.toLowerCase(), a]));
  const missingRequired = missingRequiredEbayAspects(categoryAspects, aspects);
  const invalidSelectionValues: ValidateRemappedAspectsResult["invalidSelectionValues"] = [];

  for (const schema of categoryAspects) {
    if (schema.mode !== "SELECTION_ONLY" || schema.suggestedValues.length === 0) continue;
    const row = aspectMap.get(schema.name.toLowerCase());
    if (!row?.value.trim()) continue;
    const allowed = schema.suggestedValues;
    const ok = allowed.some((v) => v.toLowerCase() === row.value.trim().toLowerCase());
    if (!ok) {
      invalidSelectionValues.push({
        name: schema.name,
        value: row.value,
        allowed: allowed.slice(0, 20),
      });
    }
  }

  return {
    valid: missingRequired.length === 0 && invalidSelectionValues.length === 0,
    missingRequired,
    invalidSelectionValues,
  };
}

export function formatAspectValidationErrors(
  missingRequired: string[],
  invalidSelectionValues: ValidateRemappedAspectsResult["invalidSelectionValues"]
): string {
  const parts: string[] = [];
  if (missingRequired.length > 0) {
    parts.push(`Missing required eBay item specifics: ${missingRequired.join(", ")}`);
  }
  for (const inv of invalidSelectionValues) {
    parts.push(
      `"${inv.name}" value "${inv.value}" is not allowed. Choose from: ${inv.allowed.join(", ")}`
    );
  }
  return parts.join(". ") + (parts.length ? ". Fill them in under eBay Listing Requirements." : "");
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
    // Live eBay listing specifics fill gaps; non-empty INW values still win on conflicts.
    aspects = mergeAspectSources(args.tradingAspects, aspects);
  }

  let categoryAspects: EbayCategoryAspect[] = [];
  if (args.categoryId?.trim()) {
    try {
      const schema = await fetchCategorySchema(args.categoryId);
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
  const remappedAspects = backfillRequiredTaxonomyAspects(
    categoryAspects,
    remapped.aspects,
    aspects,
    args.item.title ?? ""
  );

  const validation = validateRemappedAspects(categoryAspects, remappedAspects);
  const enriched = JSON.stringify(aspects) !== beforeKey;

  let missingRequired = validation.missingRequired;
  if (args.categoryId?.trim() && categoryAspects.length === 0) {
    missingRequired = [
      ...missingRequired,
      "eBay category taxonomy (could not load required item specifics for this category)",
    ];
  }

  const nextItem: SyncStoreItem = {
    ...args.item,
    // When taxonomy is available, always use remapped keys — never fall back to Trading names.
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

  const merged = fillEmptyTaxonomyAspectsFromTitle(
    args.item.title ?? "",
    categoryAspects,
    parseStoredAspects(args.item.aspects)
  );
  const expanded = expandGradedCoinAspectsForTaxonomy(categoryAspects, merged);
  const remapped = remapAspectsToTaxonomy(categoryAspects, expanded);
  const remappedAspects = backfillRequiredTaxonomyAspects(
    categoryAspects,
    remapped.aspects,
    expanded,
    args.item.title ?? ""
  );
  const validation = validateRemappedAspects(categoryAspects, remappedAspects);

  if (validation.missingRequired.length > 0 || validation.invalidSelectionValues.length > 0) {
    errors.push(formatAspectValidationErrors(validation.missingRequired, validation.invalidSelectionValues));
  }

  return { valid: errors.length === 0, errors };
}
