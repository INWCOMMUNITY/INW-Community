/**
 * Pure eBay aspect preparation — Trading/import names → Taxonomy names.
 * No server-only imports; safe for client components and shared validation.
 */

import { aspectsToEbayProductAspects, normalizeListingAspects, type ListingAspect } from "@/lib/listing-limits";

export type EbayAspectMode = "FREE_TEXT" | "SELECTION_ONLY";

/** Minimal category aspect schema (matches EbayCategoryAspect from aspects.ts). */
export type CategoryAspectSchema = {
  name: string;
  required: boolean;
  mode: EbayAspectMode;
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

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

export type RemapAspectsResult = {
  aspects: ListingAspect[];
  dropped: string[];
  valueAdjustments: { name: string; from: string; to: string }[];
};

export type ValidateRemappedAspectsResult = {
  valid: boolean;
  missingRequired: string[];
  invalidSelectionValues: { name: string; value: string; allowed: string[] }[];
};

export type PrepareAspectsResult = ValidateRemappedAspectsResult & {
  remappedAspects: ListingAspect[];
  dropped: string[];
};

const YEAR_SOURCE_NAMES = new Set(["year", "year of issue", "year of manufacture"]);

const GRADER_SOURCE_NAMES = new Set([
  "certification",
  "certification service",
  "professional grader",
  "grader",
  "professional grader (certification service)",
]);

/**
 * eBay Inventory API sub-grade fields — not real coin-industry terms.
 * Derived silently from Grade (e.g. MS 67 → numeric 67) on push; never shown to sellers.
 */
export const EBAY_DERIVED_GRADE_ASPECTS = new Set(["letter grade", "numerical grade"]);

/** Category aspects sellers actually fill in (excludes eBay-only derived grade sub-fields). */
export function filterSellerVisibleCategoryAspects(
  categoryAspects: CategoryAspectSchema[]
): CategoryAspectSchema[] {
  return categoryAspects.filter((a) => !EBAY_DERIVED_GRADE_ASPECTS.has(a.name.toLowerCase()));
}

/** Strip eBay-only derived aspects from stored/displayed rows. */
export function filterSellerVisibleAspectRows(aspects: ListingAspect[]): ListingAspect[] {
  return aspects.filter((a) => !EBAY_DERIVED_GRADE_ASPECTS.has(a.name.trim().toLowerCase()));
}

type GradedCoinInfo = {
  grader: string;
  gradeLabel: string;
  numeric: string;
};

function extractGradedCoinInfo(sources: ListingAspect[], title: string): GradedCoinInfo | null {
  let grader: string | null = null;
  let gradeLabel: string | null = null;
  let numeric: string | null = null;

  for (const a of sources) {
    const nameLower = a.name.trim().toLowerCase();
    const value = a.value.trim();
    if (!value) continue;

    if (GRADER_SOURCE_NAMES.has(nameLower)) {
      grader = grader ?? value.toUpperCase();
    }

    const parsed = parseCoinGradeLabel(value);
    if (parsed) {
      gradeLabel = gradeLabel ?? parsed.label;
      numeric = numeric ?? parsed.numeric;
    } else if (nameLower === "grade") {
      gradeLabel = gradeLabel ?? value;
    }
  }

  const titleGrader = title.trim().match(/\b(NGC|PCGS|ANACS|ICG|PMG|CACG)\b/i);
  if (titleGrader) grader = grader ?? titleGrader[1]!.toUpperCase();

  const titleGrade = title.trim().match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
  if (titleGrade) {
    gradeLabel = gradeLabel ?? `${titleGrade[1]!.toUpperCase()} ${titleGrade[2]}`;
    numeric = numeric ?? titleGrade[2]!;
  }

  if (!grader || !numeric) return null;
  return { grader, gradeLabel: gradeLabel ?? numeric, numeric };
}

/**
 * Inject eBay Inventory-only graded-coin sub-fields (Letter grade / Numerical grade)
 * that the Taxonomy API often omits but the Inventory API still requires on publish.
 * Coin sellers use Grade + Certification — this maps those to what eBay expects.
 */
export function ensureGradedCoinInventoryAspects(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[],
  sources: ListingAspect[],
  title: string
): ListingAspect[] {
  const info = extractGradedCoinInfo([...sources, ...aspects], title);
  if (!info) return aspects;

  const out = new Map(aspects.map((a) => [a.name.toLowerCase(), a]));
  const has = (name: string) => !!out.get(name.toLowerCase())?.value.trim();

  const proName = findCategoryAspectName(categoryAspects, ["Professional grader"]) ?? "Professional grader";
  if (!has(proName)) {
    out.set(proName.toLowerCase(), { name: proName, value: info.grader });
  }

  const gradeName = findCategoryAspectName(categoryAspects, ["Grade"]) ?? "Grade";
  if (!has(gradeName)) {
    out.set(gradeName.toLowerCase(), { name: gradeName, value: info.gradeLabel });
  }

  if (!has("numerical grade")) {
    const numName = findCategoryAspectName(categoryAspects, ["Numerical grade"]) ?? "Numerical grade";
    out.set(numName.toLowerCase(), { name: numName, value: info.numeric });
  }

  // Letter grade: taxonomy may omit it (e.g. 41087) while Inventory API still requires it.
  if (!has("letter grade")) {
    const letterName = findCategoryAspectName(categoryAspects, ["Letter grade"]) ?? "Letter grade";
    out.set(letterName.toLowerCase(), { name: letterName, value: info.numeric });
  }

  return normalizeListingAspects(Array.from(out.values()));
}

function productAspectsToListingAspects(aspects: Record<string, string[]>): ListingAspect[] {
  const rows: ListingAspect[] = [];
  for (const [name, values] of Object.entries(aspects)) {
    for (const v of values) {
      const value = String(v).trim();
      if (value) rows.push({ name, value });
    }
  }
  return rows;
}

function mergeProductAspectRecords(
  ...sources: Array<Record<string, string[]> | null | undefined>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [name, values] of Object.entries(src)) {
      const trimmedName = name.trim();
      if (!trimmedName) continue;
      const existingKey = Object.keys(out).find((k) => k.toLowerCase() === trimmedName.toLowerCase());
      const key = existingKey ?? trimmedName;
      if (!out[key]) out[key] = [];
      for (const v of values) {
        const val = String(v).trim();
        if (val && !out[key].includes(val)) out[key].push(val);
      }
    }
  }
  return out;
}

function remapTradingAspectRowsForInventoryPut(rows: ListingAspect[]): ListingAspect[] {
  const displayNames: Record<string, string> = {
    "professional grader": "Professional grader",
    grade: "Grade",
    "letter grade": "Letter grade",
    "numerical grade": "Numerical grade",
    year: "Year",
    mint: "Mint",
    "strike type": "Strike Type",
    denomination: "Denomination",
    country: "Country",
    "certification number": "Certification Number",
  };

  const out = new Map<string, ListingAspect>();
  for (const raw of rows) {
    const value = raw.value.trim();
    if (!value) continue;
    const nameLower = raw.name.trim().toLowerCase();

    let canonicalName = displayNames[nameLower] ?? null;
    if (!canonicalName) {
      for (const [canonicalLower, aliases] of Object.entries(EBAY_ASPECT_SYNONYMS)) {
        if (aliases.includes(nameLower)) {
          canonicalName = displayNames[canonicalLower] ?? raw.name.trim();
          break;
        }
      }
    }
    if (!canonicalName) canonicalName = raw.name.trim();

    const key = canonicalName.toLowerCase();
    if (!out.has(key)) {
      out.set(key, { name: canonicalName, value });
    }
  }
  return normalizeListingAspects(Array.from(out.values()));
}

/** Trading/GetItem grader fields — sellers see Certification, not Professional grader. */
function extractGraderFromAspectRecord(
  merged: Record<string, string[]>,
  title: string
): string | null {
  for (const [name, values] of Object.entries(merged)) {
    if (!GRADER_SOURCE_NAMES.has(name.trim().toLowerCase())) continue;
    const v = values.find((x) => String(x).trim());
    if (v) return String(v).trim().toUpperCase();
  }
  const m = title.trim().match(/\b(NGC|PCGS|ANACS|ICG|PMG|CACG)\b/i);
  return m ? m[1]!.toUpperCase() : null;
}

/** Remove Trading-only grader aliases from Inventory PUT payload (wire uses Professional grader). */
function stripTradingGraderAliases(product: Record<string, string[]>): void {
  for (const key of Object.keys(product)) {
    const lower = key.toLowerCase();
    if (lower === "professional grader") continue;
    if (GRADER_SOURCE_NAMES.has(lower)) delete product[key];
  }
}

/**
 * Passthrough push helper — silently translate Trading names (Certification, Grade) to
 * Inventory API keys (Professional grader, Letter grade). Sellers never see the latter.
 */
export function enrichInventoryProductAspectsForPush(
  liveAspects: Record<string, string[]>,
  title: string,
  ...fallbackAspects: Array<Record<string, string[]> | null | undefined>
): Record<string, string[]> {
  const merged = mergeProductAspectRecords(liveAspects, ...fallbackAspects);
  let rows = productAspectsToListingAspects(merged);
  rows = remapTradingAspectRowsForInventoryPut(rows);
  const enriched = ensureGradedCoinInventoryAspects([], rows, rows, title);
  const product = aspectsToEbayProductAspects(enriched);

  // Inventory API requires "Professional grader"; live GET and GetItem use Certification.
  if (!product["Professional grader"]?.some((v) => v.trim())) {
    const grader = extractGraderFromAspectRecord(merged, title);
    if (grader) product["Professional grader"] = [grader];
  }

  stripTradingGraderAliases(product);
  return product;
}

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

function findCategoryAspectName(
  categoryAspects: CategoryAspectSchema[],
  candidates: string[]
): string | null {
  const byLower = new Map(categoryAspects.map((a) => [a.name.toLowerCase(), a.name]));
  for (const c of candidates) {
    const hit = byLower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function buildTaxonomyNameLookup(categoryAspects: CategoryAspectSchema[]): Map<string, string> {
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
    const canonicalHit = taxonomyLookup.get(canonicalLower);
    if (canonicalHit) return canonicalHit;
    for (const alias of aliases) {
      const byAlias = taxonomyLookup.get(alias);
      if (byAlias) return byAlias;
    }
  }
  return null;
}

function normalizeSelectionValue(
  aspect: CategoryAspectSchema,
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

export function remapAspectsToTaxonomy(
  categoryAspects: CategoryAspectSchema[],
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

    const canonicalName =
      taxonomyLookup.get(nameLower) ?? resolveSynonymTarget(nameLower, taxonomyLookup);

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

function extractYearValue(sources: ListingAspect[], title: string): string | null {
  for (const a of sources) {
    if (YEAR_SOURCE_NAMES.has(a.name.trim().toLowerCase()) && a.value.trim()) {
      return a.value.trim();
    }
  }
  const match = title.trim().match(/\b((?:18|19|20)\d{2})(?:-[A-Z]{1,3})?\b/);
  return match?.[1] ?? null;
}

export function backfillRequiredTaxonomyAspects(
  categoryAspects: CategoryAspectSchema[],
  remappedAspects: ListingAspect[],
  sources: ListingAspect[],
  title: string
): ListingAspect[] {
  if (categoryAspects.length === 0) return remappedAspects;

  const out = new Map(remappedAspects.map((a) => [a.name.toLowerCase(), a]));
  const missing = missingRequiredEbayAspects(categoryAspects, remappedAspects);

  for (const req of missing) {
    if (!req.toLowerCase().includes("year")) continue;
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

  const retryRemap = remapAspectsToTaxonomy(categoryAspects, [
    ...sources,
    ...normalizeListingAspects(Array.from(out.values())),
  ]);
  for (const a of retryRemap.aspects) {
    out.set(a.name.toLowerCase(), a);
  }

  return normalizeListingAspects(Array.from(out.values()));
}

export function fillEmptyTaxonomyAspectsFromTitle(
  title: string,
  categoryAspects: CategoryAspectSchema[],
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

export function expandGradedCoinAspectsForTaxonomy(
  categoryAspects: CategoryAspectSchema[],
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
  categoryAspects: CategoryAspectSchema[],
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

export function validateRemappedAspects(
  categoryAspects: CategoryAspectSchema[],
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

/**
 * Full Trading→Taxonomy pipeline used by sync, forms, and import normalization.
 * Matches prepareOutboundAspects logic without inventory/Trading merges.
 */
export function prepareAspectsForEbayCategory(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[],
  title: string
): PrepareAspectsResult {
  const merged = fillEmptyTaxonomyAspectsFromTitle(title, categoryAspects, aspects);
  const expanded = expandGradedCoinAspectsForTaxonomy(categoryAspects, merged);
  const remapped = remapAspectsToTaxonomy(categoryAspects, expanded);
  const backfilled = backfillRequiredTaxonomyAspects(
    categoryAspects,
    remapped.aspects,
    expanded,
    title
  );
  const ensured = ensureGradedCoinInventoryAspects(categoryAspects, backfilled, expanded, title);
  const sellerVisible = filterSellerVisibleAspectRows(ensured);
  const sellerSchema = filterSellerVisibleCategoryAspects(categoryAspects);
  const validation = validateRemappedAspects(sellerSchema, sellerVisible);
  return {
    ...validation,
    remappedAspects: sellerVisible,
    dropped: remapped.dropped,
  };
}

/** Remap stored aspects to taxonomy names and seed empty rows for still-missing required fields. */
export function prepareAspectRowsForForm(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[],
  title: string
): ListingAspect[] {
  const prep = prepareAspectsForEbayCategory(categoryAspects, aspects, title);
  const rows = [...prep.remappedAspects];
  const existing = new Set(rows.map((a) => a.name.toLowerCase()));

  for (const name of prep.missingRequired) {
    const key = name.toLowerCase();
    if (!existing.has(key)) {
      rows.push({ name, value: "" });
      existing.add(key);
    }
  }

  return filterSellerVisibleAspectRows(rows).slice(0, 30);
}
