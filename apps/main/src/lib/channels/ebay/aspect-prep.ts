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
  brand: ["brand name"],
  type: ["item type"],
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

/**
 * Dime categories where Inventory PUT Letter grade uses the numeric part (69) not the prefix (PR).
 * Runtime evidence: 39458 rejects Letter grade=PR but requires Letter grade on PUT.
 */
export const EBAY_DIME_NUMERIC_LETTER_GRADE_CATEGORY_IDS = new Set([
  "39458", // US Roosevelt Dimes
]);

/** @deprecated Use EBAY_DIME_NUMERIC_LETTER_GRADE_CATEGORY_IDS */
export const EBAY_NUMERICAL_GRADE_ONLY_CATEGORY_IDS = EBAY_DIME_NUMERIC_LETTER_GRADE_CATEGORY_IDS;

export function inventoryPutLetterGradeIsNumeric(categoryId?: string | number | null): boolean {
  const id = categoryId != null ? String(categoryId).trim() : "";
  return id !== "" && EBAY_DIME_NUMERIC_LETTER_GRADE_CATEGORY_IDS.has(id);
}

/** Inventory PUT requires Letter grade for graded coins (nickel prefix MS; dime numeric 69). */
export function inventoryPutUsesLetterGrade(
  _categoryAspects: CategoryAspectSchema[] = [],
  _categoryId?: string | number | null
): boolean {
  return true;
}

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

  // Letter grade: Inventory API expects the grade prefix (MS, PR, …) — live GET stores "MS" not "67".
  if (!has("letter grade")) {
    const letterName = findCategoryAspectName(categoryAspects, ["Letter grade"]) ?? "Letter grade";
    const letterPrefix = info.gradeLabel.trim().match(/^(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)\b/i)?.[1]?.toUpperCase();
    out.set(letterName.toLowerCase(), {
      name: letterName,
      value: letterPrefix ?? info.numeric,
    });
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

/** Derive grade prefix + numeric from Trading Grade or title. */
function extractGradePartsFromAspectRecord(
  merged: Record<string, string[]>,
  title: string
): { prefix: string; numeric: string } | null {
  for (const [name, values] of Object.entries(merged)) {
    if (name.trim().toLowerCase() !== "grade") continue;
    for (const v of values) {
      const parsed = parseCoinGradeLabel(String(v));
      if (parsed) return { prefix: parsed.prefix, numeric: parsed.numeric };
    }
  }
  const titleGrade = title.trim().match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
  if (titleGrade) {
    return { prefix: titleGrade[1]!.toUpperCase(), numeric: titleGrade[2]! };
  }
  return null;
}

function pickFirstAspectValue(
  aspects: Record<string, string[]>,
  name: string
): string | null {
  const key = Object.keys(aspects).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return null;
  const v = aspects[key]?.find((x) => String(x).trim());
  return v ? String(v).trim() : null;
}

function isGradedCoinContext(merged: Record<string, string[]>, title: string): boolean {
  return (
    !!extractGraderFromAspectRecord(merged, title) && !!extractGradePartsFromAspectRecord(merged, title)
  );
}

/** Live inventory GET stored numeric value in Letter grade where nickel expects prefix (MS). */
export function liveInventoryWireGradesCorrupted(
  liveAspects: Record<string, string[]>,
  categoryId?: string | number | null
): boolean {
  const letter = pickFirstAspectValue(liveAspects, "Letter grade");
  if (!letter) return false;
  if (inventoryPutLetterGradeIsNumeric(categoryId)) {
    return /^[A-Z]{1,3}$/.test(letter) && letter !== pickFirstAspectValue(liveAspects, "Numerical grade");
  }
  return /^\d{1,2}$/.test(letter);
}

/** Graded coins (or corrupted live wire grades) need GetItem-backed aspect prep, not live overlay. */
export function passthroughUsePreparedInventoryAspects(
  liveAspects: Record<string, string[]>,
  categoryId: string | number | null | undefined,
  tradingAspects: Record<string, string[]> | null | undefined,
  title: string
): boolean {
  if (liveInventoryWireGradesCorrupted(liveAspects, categoryId)) return true;
  const merged = mergeProductAspectRecords(liveAspects, tradingAspects ?? {});
  return isGradedCoinContext(merged, title);
}

/**
 * Inventory API wire-only sub-fields (Letter grade / Numerical grade).
 * Letter grade = prefix (MS, PR, …); Numerical grade = numeric (67, 69, …).
 * Preserves live inventory GET values when eBay already accepted them.
 */
function snapToSuggestedValue(aspect: CategoryAspectSchema | undefined, value: string): string {
  if (!aspect) return value;
  const normalized = normalizeSelectionValue(aspect, value);
  if (normalized.adjusted || aspect.suggestedValues.includes(normalized.value)) {
    return normalized.value;
  }
  const v = value.trim().toLowerCase();
  const hit = aspect.suggestedValues.find((s) => {
    const sl = s.toLowerCase();
    return sl === v || sl.startsWith(`${v} `) || sl.includes(`(${v})`) || sl.split(/[\s(/]+/)[0] === v;
  });
  return hit ?? value;
}

const KNOWN_GRADER_LABELS: Record<string, string> = {
  NGC: "NGC (Numismatic Guaranty Corporation)",
  PCGS: "PCGS (Professional Coin Grading Service)",
  ANACS: "ANACS",
  ICG: "ICG",
  PMG: "PMG",
  CACG: "CACG",
};

function snapGraderValue(schema: CategoryAspectSchema | undefined, grader: string): string {
  const trimmed = grader.trim();
  const prefixMatch = trimmed.match(/^(NGC|PCGS|ANACS|ICG|PMG|CACG)\b/i);
  const prefix = prefixMatch?.[1]?.toUpperCase();

  if (schema?.suggestedValues.length) {
    const normalized = normalizeSelectionValue(schema, trimmed);
    if (normalized.adjusted || schema.suggestedValues.includes(normalized.value)) {
      return normalized.value;
    }
    if (prefix) {
      const bareHit = schema.suggestedValues.find((s) => s.toUpperCase() === prefix);
      if (bareHit) return bareHit;
      const labeledHit = schema.suggestedValues.find((s) => {
        const sl = s.toLowerCase();
        return sl.startsWith(`${prefix.toLowerCase()} `) || sl.includes(`(${prefix.toLowerCase()})`);
      });
      if (labeledHit) return labeledHit;
    }
    return trimmed;
  }

  if (prefix) {
    return prefix;
  }
  return trimmed;
}

function snapAspectValueForInventoryPut(aspect: CategoryAspectSchema, value: string): string {
  const nameLower = aspect.name.toLowerCase();
  if (nameLower === "professional grader") {
    return snapGraderValue(aspect, value);
  }
  return snapToSuggestedValue(aspect, value);
}

/** Duplicate synonym aspects on Inventory PUT trigger misleading #25064 errors. */
const INVENTORY_PUT_ASPECT_DEDUPE: Array<{ keep: string; drop: string[] }> = [
  { keep: "Country of Origin", drop: ["Country"] },
  { keep: "Mint Location", drop: ["Mint"] },
  { keep: "Professional grader", drop: ["Certification", "Certification Service", "Grader"] },
];

export function dedupeInventoryPutAspectAliases(product: Record<string, string[]>): void {
  for (const { keep, drop } of INVENTORY_PUT_ASPECT_DEDUPE) {
    if (!pickFirstAspectValue(product, keep)) continue;
    for (const alias of drop) {
      const dropKey = Object.keys(product).find((k) => k.toLowerCase() === alias.toLowerCase());
      if (dropKey) delete product[dropKey];
    }
  }
}

function resolveLetterGradeWireValue(
  categoryId: string | number | null | undefined,
  parts: { prefix: string; numeric: string },
  liveLetter: string | null
): string {
  if (inventoryPutLetterGradeIsNumeric(categoryId)) return parts.numeric;
  if (liveLetter && !/^\d{1,2}$/.test(liveLetter)) return liveLetter;
  return parts.prefix;
}

function hasAspectValue(product: Record<string, string[]>, name: string): boolean {
  return !!pickFirstAspectValue(product, name);
}

function setAspectValue(product: Record<string, string[]>, name: string, value: string): void {
  const existing = Object.keys(product).find((k) => k.toLowerCase() === name.toLowerCase());
  product[existing ?? name] = [value];
}

function findSourceValueForAspect(
  sources: Record<string, string[]>,
  aspectName: string
): string | null {
  const direct = pickFirstAspectValue(sources, aspectName);
  if (direct) return direct;
  const nameLower = aspectName.toLowerCase();
  const aliases = EBAY_ASPECT_SYNONYMS[nameLower] ?? [];
  for (const alias of aliases) {
    const hit = pickFirstAspectValue(sources, alias);
    if (hit) return hit;
  }
  for (const [canonical, list] of Object.entries(EBAY_ASPECT_SYNONYMS)) {
    if (canonical !== nameLower && !list.includes(nameLower)) continue;
    for (const alias of [canonical, ...list]) {
      const hit = pickFirstAspectValue(sources, alias);
      if (hit) return hit;
    }
  }
  return null;
}

export function applyGradedCoinWireAspects(
  product: Record<string, string[]>,
  merged: Record<string, string[]>,
  title: string,
  liveAspects: Record<string, string[]> = {},
  categoryAspects: CategoryAspectSchema[] = [],
  categoryId?: string | number | null
): void {
  if (!isGradedCoinContext(merged, title) && !extractGradePartsFromAspectRecord(merged, title)) {
    return;
  }

  const parts = extractGradePartsFromAspectRecord(merged, title);
  const grader = extractGraderFromAspectRecord(merged, title);
  const graderSchema = categoryAspects.find((a) => a.name.toLowerCase() === "professional grader");
  const graderName = graderSchema?.name ?? "Professional grader";
  if (grader) {
    setAspectValue(product, graderName, snapGraderValue(graderSchema, grader));
  }

  const liveLetter = pickFirstAspectValue(liveAspects, "Letter grade");
  const liveNumerical = pickFirstAspectValue(liveAspects, "Numerical grade");
  const letterSchema = categoryAspects.find((a) => a.name.toLowerCase() === "letter grade");
  const numericalSchema = categoryAspects.find((a) => a.name.toLowerCase() === "numerical grade");
  const letterName = letterSchema?.name ?? "Letter grade";
  const numericalName = numericalSchema?.name ?? "Numerical grade";

  const usesLetterGrade = inventoryPutUsesLetterGrade(categoryAspects, categoryId);
  const currentLetter = pickFirstAspectValue(product, letterName);
  const letterIsNumericOnly = currentLetter != null && /^\d{1,2}$/.test(currentLetter);
  const letterIsPrefixOnly =
    currentLetter != null && /^[A-Z]{1,3}$/.test(currentLetter) && inventoryPutLetterGradeIsNumeric(categoryId);
  const letterIsFullGrade =
    currentLetter != null && parts != null && parseCoinGradeLabel(currentLetter) != null;
  if (
    usesLetterGrade &&
    parts &&
    (!hasAspectValue(product, letterName) ||
      letterIsNumericOnly ||
      letterIsPrefixOnly ||
      (letterIsFullGrade && parseCoinGradeLabel(currentLetter!)!.prefix !== parts.prefix))
  ) {
    const letter = resolveLetterGradeWireValue(categoryId, parts, liveLetter);
    setAspectValue(product, letterName, snapToSuggestedValue(letterSchema, letter));
  }

  const currentNumerical = pickFirstAspectValue(product, numericalName);
  const numericalMatchesBadLetter =
    letterIsNumericOnly && currentNumerical != null && currentNumerical === currentLetter;
  if (
    !hasAspectValue(product, numericalName) ||
    numericalMatchesBadLetter ||
    (parts?.numeric && currentNumerical === parts.prefix)
  ) {
    const numerical = parts?.numeric ?? liveNumerical;
    if (numerical) setAspectValue(product, numericalName, snapToSuggestedValue(numericalSchema, numerical));
  }
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
 * Inventory PUT aspects: live GET keys stay verbatim; fill required Taxonomy keys
 * from GetItem / stored rows using localized names and suggested values.
 */
export function enrichInventoryProductAspectsForPush(
  liveAspects: Record<string, string[]>,
  title: string,
  categoryAspects: CategoryAspectSchema[] = [],
  ...fallbackAspects: Array<Record<string, string[]> | null | undefined>
): Record<string, string[]> {
  return prepareLiveAspectsForInventoryPut(
    liveAspects,
    title,
    categoryAspects,
    {},
    ...fallbackAspects
  );
}

function stripWireAspectsNotInTaxonomy(
  product: Record<string, string[]>,
  categoryAspects: CategoryAspectSchema[],
  categoryId?: string | number | null
): void {
  const letterVal = pickFirstAspectValue(product, "Letter grade");
  const numericalVal = pickFirstAspectValue(product, "Numerical grade");
  if (!letterVal) return;

  if (inventoryPutLetterGradeIsNumeric(categoryId)) {
    // Dime: Letter grade must be numeric (69). Drop prefix-only values like PR.
    if (/^[A-Z]{1,3}$/.test(letterVal) && letterVal !== numericalVal) {
      for (const key of Object.keys(product)) {
        if (key.toLowerCase() === "letter grade") delete product[key];
      }
    }
    return;
  }

  // Nickel: drop numeric-only Letter grade duplicates (e.g. Letter grade=69).
  if (/^\d{1,2}$/.test(letterVal) || (numericalVal && letterVal === numericalVal)) {
    for (const key of Object.keys(product)) {
      if (key.toLowerCase() === "letter grade") delete product[key];
    }
  }
}

/** Taxonomy GET often omits Inventory-only wire fields; backfill after taxonomy strip. */
function backfillInventoryOnlyWireAspects(
  product: Record<string, string[]>,
  merged: Record<string, string[]>,
  title: string,
  categoryAspects: CategoryAspectSchema[] = [],
  categoryId?: string | number | null
): void {
  const parts = extractGradePartsFromAspectRecord(merged, title);
  if (!parts) return;

  const grader = extractGraderFromAspectRecord(merged, title);
  if (grader && !hasAspectValue(product, "Professional grader")) {
    const schema = categoryAspects.find((a) => a.name.toLowerCase() === "professional grader");
    setAspectValue(
      product,
      schema?.name ?? "Professional grader",
      snapGraderValue(schema, grader)
    );
  }

  const letterSchema = categoryAspects.find((a) => a.name.toLowerCase() === "letter grade");
  const numericalSchema = categoryAspects.find((a) => a.name.toLowerCase() === "numerical grade");
  const letterName = letterSchema?.name ?? "Letter grade";
  const numericalName = numericalSchema?.name ?? "Numerical grade";

  if (
    inventoryPutUsesLetterGrade(categoryAspects, categoryId) &&
    !hasAspectValue(product, letterName) &&
    parts
  ) {
    const letter = resolveLetterGradeWireValue(categoryId, parts, null);
    setAspectValue(product, letterName, snapToSuggestedValue(letterSchema, letter));
  }
  if (!hasAspectValue(product, numericalName)) {
    setAspectValue(product, numericalName, snapToSuggestedValue(numericalSchema, parts.numeric));
  }
}

export type PrepareLiveAspectsOptions = {
  /** Title-only PUT: keep live Letter/Numerical grade when live GET already has grader + Grade. */
  preserveLiveWireGrades?: boolean;
  /** eBay leaf category id — disambiguates nickel vs dime wire-grade rules. */
  categoryId?: string | number | null;
};

function liveHasAcceptedWireGrades(
  liveAspects: Record<string, string[]>,
  categoryId?: string | number | null
): boolean {
  if (liveInventoryWireGradesCorrupted(liveAspects, categoryId)) return false;
  const hasGrader =
    hasAspectValue(liveAspects, "Professional grader") ||
    hasAspectValue(liveAspects, "Certification");
  const hasGrade =
    hasAspectValue(liveAspects, "Grade") ||
    hasAspectValue(liveAspects, "Letter grade") ||
    hasAspectValue(liveAspects, "Numerical grade");
  return hasGrader && hasGrade;
}

function ensureProfessionalGrader(
  product: Record<string, string[]>,
  merged: Record<string, string[]>,
  title: string,
  categoryAspects: CategoryAspectSchema[]
): void {
  const schema = categoryAspects.find((a) => a.name.toLowerCase() === "professional grader");
  const proName = schema?.name ?? "Professional grader";
  const existing = pickFirstAspectValue(product, proName);
  const grader = existing ?? extractGraderFromAspectRecord(merged, title);
  if (!grader) return;
  // Always re-snap: live GET often stores bare "NGC" but Inventory PUT requires taxonomy label.
  setAspectValue(product, proName, snapGraderValue(schema, grader));
}

/** Inventory wire fields replace seller Grade on PUT only when Grade is not a required category aspect. */
function stripSellerGradeWhenWireAspectsPresent(
  product: Record<string, string[]>,
  categoryAspects: CategoryAspectSchema[] = []
): void {
  const gradeRequired = categoryAspects.some(
    (a) => a.required && a.name.toLowerCase() === "grade"
  );
  if (gradeRequired) return;
  if (
    !hasAspectValue(product, "Professional grader") ||
    !hasAspectValue(product, "Numerical grade")
  ) {
    return;
  }
  for (const key of Object.keys(product)) {
    if (key.toLowerCase() === "grade") delete product[key];
  }
}

const INVENTORY_PUT_WIRE_GRADE_NAMES = ["Professional grader", "Letter grade", "Numerical grade"];

/** Title/photo PUT: keep live inventory GET wire values verbatim when eBay already accepted them. */
function restoreLiveWireGradeAspects(
  product: Record<string, string[]>,
  liveAspects: Record<string, string[]>,
  categoryId?: string | number | null
): void {
  for (const name of INVENTORY_PUT_WIRE_GRADE_NAMES) {
    const liveVal = pickFirstAspectValue(liveAspects, name);
    if (!liveVal) continue;
    if (name.toLowerCase() === "letter grade" && liveInventoryWireGradesCorrupted(liveAspects, categoryId)) {
      continue;
    }
    setAspectValue(product, name, liveVal);
  }
}

/** Final pass: Inventory PUT must include every required category aspect (eBay validates full set). */
function ensureRequiredAspectsForInventoryPut(
  product: Record<string, string[]>,
  merged: Record<string, string[]>,
  title: string,
  categoryAspects: CategoryAspectSchema[],
  categoryId?: string | number | null
): void {
  ensureProfessionalGrader(product, merged, title, categoryAspects);

  for (const aspect of categoryAspects) {
    if (!aspect.required) continue;
    if (hasAspectValue(product, aspect.name)) continue;
    const raw = findSourceValueForAspect(merged, aspect.name);
    if (raw) setAspectValue(product, aspect.name, snapToSuggestedValue(aspect, raw));
  }

  if (!hasAspectValue(product, "Year")) {
    const year = findSourceValueForAspect(merged, "Year");
    if (year) {
      setAspectValue(product, "Year", year);
    } else {
      const fromTitle = title.match(/\b(18|19|20)\d{2}\b/);
      if (fromTitle) setAspectValue(product, "Year", fromTitle[0]!);
    }
  }

  const letterRequired = categoryAspects.some(
    (a) => a.required && a.name.toLowerCase() === "letter grade"
  );
  const numericalRequired = categoryAspects.some(
    (a) => a.required && a.name.toLowerCase() === "numerical grade"
  );
  const hasGradeSource =
    hasAspectValue(merged, "Grade") || !!extractGradePartsFromAspectRecord(merged, title);
  const needsWireGrades =
    isGradedCoinContext(merged, title) ||
    letterRequired ||
    numericalRequired ||
    hasGradeSource;

  const missingLetter =
    inventoryPutUsesLetterGrade(categoryAspects, categoryId) &&
    !hasAspectValue(product, "Letter grade");
  if (
    needsWireGrades &&
    (!hasAspectValue(product, "Numerical grade") ||
      !hasAspectValue(product, "Professional grader") ||
      missingLetter)
  ) {
    backfillInventoryOnlyWireAspects(product, merged, title, categoryAspects, categoryId);
  }
}

/**
 * Live inventory GET aspects plus minimal graded-coin wire fixes for Inventory PUT.
 * Keeps seller-visible specifics verbatim; only repairs wire keys eBay validates on PUT.
 */
export function prepareLiveAspectsForInventoryPut(
  liveAspects: Record<string, string[]>,
  title: string,
  categoryAspects: CategoryAspectSchema[] = [],
  options: PrepareLiveAspectsOptions = {},
  ...fallbackAspects: Array<Record<string, string[]> | null | undefined>
): Record<string, string[]> {
  const merged = mergeProductAspectRecords(liveAspects, ...fallbackAspects);

  // eBay validates the FULL required aspect set on every PUT — merge all sources, live wins conflicts.
  const product: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(merged)) {
    const kept = values.map((v) => String(v).trim()).filter(Boolean);
    if (kept.length > 0) product[name] = kept;
  }
  for (const [name, values] of Object.entries(liveAspects)) {
    const kept = values.map((v) => String(v).trim()).filter(Boolean);
    if (kept.length > 0) product[name] = kept;
  }

  const categoryId = options.categoryId;
  const skipLetterNumericalRewrite =
    options.preserveLiveWireGrades === true &&
    liveHasAcceptedWireGrades(liveAspects, categoryId);

  if (!skipLetterNumericalRewrite) {
    applyGradedCoinWireAspects(
      product,
      merged,
      title,
      liveAspects,
      categoryAspects,
      categoryId
    );
  } else {
    ensureProfessionalGrader(product, merged, title, categoryAspects);
  }

  for (const aspect of categoryAspects) {
    if (!aspect.required) continue;
    if (!hasAspectValue(product, aspect.name)) {
      const raw = findSourceValueForAspect(merged, aspect.name);
      if (raw) setAspectValue(product, aspect.name, snapAspectValueForInventoryPut(aspect, raw));
      continue;
    }
    const current = pickFirstAspectValue(product, aspect.name);
    if (current) setAspectValue(product, aspect.name, snapAspectValueForInventoryPut(aspect, current));
  }

  stripWireAspectsNotInTaxonomy(product, categoryAspects, categoryId);
  if (!skipLetterNumericalRewrite) {
    backfillInventoryOnlyWireAspects(product, merged, title, categoryAspects, categoryId);
  }

  ensureRequiredAspectsForInventoryPut(product, merged, title, categoryAspects, categoryId);

  ensureProfessionalGrader(product, merged, title, categoryAspects);
  stripSellerGradeWhenWireAspectsPresent(product, categoryAspects);

  if (hasAspectValue(product, "Professional grader")) {
    stripTradingGraderAliases(product);
  }

  dedupeInventoryPutAspectAliases(product);

  if (options.preserveLiveWireGrades) {
    restoreLiveWireGradeAspects(product, liveAspects, categoryId);
  }

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

const BRAND_DEFAULTS = ["Unbranded", "Does Not Apply"];
const NO_BRAND_ALIASES = new Set([
  "does not apply",
  "does not apply.",
  "n/a",
  "na",
  "unknown",
  "no brand",
  "none",
  "not applicable",
  "unbranded",
]);
const PUBLISH_OFTEN_REQUIRED = new Set(["brand", "brand name", "type"]);

export function isBrandAspectName(name: string): boolean {
  const key = name.trim().toLowerCase();
  return key === "brand" || key === "brand name";
}

export function isNoBrandAlias(value: string): boolean {
  return NO_BRAND_ALIASES.has(value.trim().toLowerCase());
}

/** Official no-brand value for this category — never invent Unbranded. */
export function officialNoBrandValue(allowed?: string[]): string | null {
  if (!allowed?.length) return null;
  for (const want of BRAND_DEFAULTS) {
    const hit = allowed.find((option) => option.trim().toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Keep official taxonomy strings. Map no-brand aliases only onto a value eBay listed. */
export function normalizeEbayBrandValue(value: string, allowed?: string[]): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (allowed?.length) {
    const exact = allowed.find((option) => option.trim().toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact;
    if (isNoBrandAlias(trimmed)) return officialNoBrandValue(allowed) ?? trimmed;
    return trimmed;
  }
  return trimmed;
}

/** Dropdown shows eBay's official values only. */
export function sellerVisibleBrandChoices(suggestedValues: string[]): string[] {
  return suggestedValues.map((value) => value.trim()).filter(Boolean);
}

export function preserveEbayAspectValues(
  nextRows: ListingAspect[],
  previousRows: ListingAspect[]
): ListingAspect[] {
  return nextRows.map((row) => {
    const prev = previousRows.find(
      (candidate) => candidate.name.trim().toLowerCase() === row.name.trim().toLowerCase()
    );
    if (prev?.value.trim() && !row.value.trim()) {
      return { ...row, value: prev.value };
    }
    return row;
  });
}

export function restoreOftenRequiredSellerAspects(
  categoryAspects: CategoryAspectSchema[],
  remapped: ListingAspect[],
  sellerAspects: ListingAspect[]
): ListingAspect[] {
  const out = new Map(remapped.map((row) => [row.name.toLowerCase(), row]));
  const sellerByKey = new Map(
    sellerAspects.map((row) => [row.name.trim().toLowerCase(), row] as const)
  );

  const applySeller = (name: string, allowed?: string[]) => {
    const key = name.toLowerCase();
    if (out.get(key)?.value.trim()) return;
    const seller = isBrandAspectName(name)
      ? sellerByKey.get("brand") ?? sellerByKey.get("brand name")
      : sellerByKey.get("type") ?? sellerByKey.get("item type");
    if (!seller?.value.trim()) return;
    const value = isBrandAspectName(name)
      ? normalizeEbayBrandValue(seller.value, allowed)
      : seller.value.trim();
    if (!value) return;
    if (allowed && allowed.length > 0 && !allowed.some((option) => option.toLowerCase() === value.toLowerCase())) {
      return;
    }
    out.set(key, { name, value });
  };

  if (categoryAspects.length === 0) {
    applySeller("Type");
    applySeller("Brand");
    return normalizeListingAspects(Array.from(out.values()));
  }

  for (const schema of categoryAspects) {
    if (!isOftenRequiredEbayAspectName(schema.name)) continue;
    applySeller(schema.name, schema.suggestedValues);
  }
  return normalizeListingAspects(Array.from(out.values()));
}

export function isOftenRequiredEbayAspectName(name: string): boolean {
  return PUBLISH_OFTEN_REQUIRED.has(name.trim().toLowerCase());
}

/** Type/Brand fields when eBay Taxonomy is rate-limited so sellers can still list. */
export function ebayListOnFallbackAspects(): CategoryAspectSchema[] {
  return [
    {
      name: "Type",
      required: true,
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      suggestedValues: [],
    },
    {
      name: "Brand",
      required: true,
      mode: "SELECTION_ONLY",
      cardinality: "SINGLE",
      suggestedValues: [...BRAND_DEFAULTS],
    },
  ];
}

/** True when eBay listed official values — show a clickable dropdown, not a text box. */
export function ebayAspectUsesDropdown(aspect: Pick<CategoryAspectSchema, "suggestedValues"> | undefined): boolean {
  return Boolean(aspect?.suggestedValues?.length);
}

export const EBAY_LIST_ON_RATE_LIMIT_NOTICE =
  "eBay is busy right now. Enter Type and Brand below, then list.";

function pickSuggestedValue(aspect: CategoryAspectSchema, want: string[]): string | null {
  for (const candidate of want) {
    const hit = aspect.suggestedValues.find((s) => s.toLowerCase() === candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Brand → official no-brand value when allowed; Type → title/category match when eBay lists values. */
export function defaultValueForEbayAspect(
  aspect: CategoryAspectSchema,
  title: string,
  extraCandidates: string[] = []
): string | null {
  const name = aspect.name.toLowerCase();
  if (name === "brand" || name === "brand name") {
    return pickSuggestedValue(aspect, BRAND_DEFAULTS) ?? (aspect.suggestedValues.length === 1 ? aspect.suggestedValues[0]! : null);
  }
  if (name === "type") {
    const hay = `${title} ${extraCandidates.join(" ")}`.toLowerCase();
    const matches = aspect.suggestedValues.filter(
      (s) => s.trim().length >= 3 && hay.includes(s.toLowerCase())
    );
    matches.sort((a, b) => b.length - a.length);
    if (matches[0]) return matches[0];
    if (aspect.suggestedValues.length === 1) return aspect.suggestedValues[0]!;
    return null;
  }
  return pickSuggestedValue(aspect, BRAND_DEFAULTS);
}

export function fillDefaultEbayAspects(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[],
  title: string,
  extraCandidates: string[] = []
): ListingAspect[] {
  const out = new Map(aspects.map((a) => [a.name.toLowerCase(), a]));
  for (const schema of categoryAspects) {
    const key = schema.name.toLowerCase();
    if (!PUBLISH_OFTEN_REQUIRED.has(key)) continue;
    if (out.get(key)?.value.trim()) continue;
    const value = defaultValueForEbayAspect(schema, title, extraCandidates);
    if (!value) continue;
    out.set(key, { name: schema.name, value });
  }
  return normalizeListingAspects(
    Array.from(out.values()).map((row) => {
      if (!isBrandAspectName(row.name) || !row.value.trim()) return row;
      const schema =
        categoryAspects.find((candidate) => candidate.name.toLowerCase() === row.name.toLowerCase()) ??
        categoryAspects.find((candidate) => isBrandAspectName(candidate.name));
      return {
        name: schema?.name ?? row.name,
        value: normalizeEbayBrandValue(row.value, schema?.suggestedValues),
      };
    })
  );
}

/** Type/Brand are often required at publish even when taxonomy marks them optional. */
export function missingOftenRequiredEbayAspects(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[]
): string[] {
  const have = new Map(aspects.map((a) => [a.name.toLowerCase(), a.value.trim()]));
  const missing: string[] = [];
  for (const schema of categoryAspects) {
    if (!PUBLISH_OFTEN_REQUIRED.has(schema.name.toLowerCase())) continue;
    if (have.get(schema.name.toLowerCase())) continue;
    missing.push(schema.name);
  }
  return missing;
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

function parseCoinGradeLabel(value: string): { label: string; prefix: string; numeric: string } | null {
  const m = value.trim().match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);
  if (!m) return null;
  const prefix = m[1]!.toUpperCase();
  return { label: `${prefix} ${m[2]!}`, prefix, numeric: m[2]! };
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

/** Taxonomy-required plus Type/Brand, which eBay often rejects even when optional in taxonomy. */
export function missingEbayAspectsForListOn(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[]
): string[] {
  const required = missingRequiredEbayAspects(categoryAspects, aspects);
  const seen = new Set(required.map((name) => name.toLowerCase()));
  const extra = missingOftenRequiredEbayAspects(categoryAspects, aspects).filter(
    (name) => !seen.has(name.toLowerCase())
  );
  return [...required, ...extra];
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
  const restored = restoreOftenRequiredSellerAspects(categoryAspects, remapped.aspects, aspects);
  const backfilled = backfillRequiredTaxonomyAspects(
    categoryAspects,
    restored,
    expanded,
    title
  );
  const ensured = ensureGradedCoinInventoryAspects(categoryAspects, backfilled, expanded, title);
  const withDefaults = fillDefaultEbayAspects(categoryAspects, ensured, title);
  const sellerVisible = filterSellerVisibleAspectRows(withDefaults);
  const sellerSchema = filterSellerVisibleCategoryAspects(categoryAspects);
  const validation = validateRemappedAspects(sellerSchema, sellerVisible);
  const missingRequired = [
    ...validation.missingRequired,
    ...missingOftenRequiredEbayAspects(sellerSchema, sellerVisible).filter(
      (name) => !validation.missingRequired.some((existing) => existing.toLowerCase() === name.toLowerCase())
    ),
  ];
  return {
    ...validation,
    missingRequired,
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

/** Required (and already-filled) item specifics for the List on eBay category popup. */
export function ebayAspectRowsForListOnPopup(
  categoryAspects: CategoryAspectSchema[],
  aspects: ListingAspect[],
  title: string
): ListingAspect[] {
  const rows = prepareAspectRowsForForm(categoryAspects, aspects, title);
  const required = new Set(
    categoryAspects
      .filter((a) => a.required || isOftenRequiredEbayAspectName(a.name))
      .map((a) => a.name.trim().toLowerCase())
  );
  const filtered = rows.filter(
    (row) => required.has(row.name.trim().toLowerCase()) || row.value.trim()
  );
  const existing = new Set(filtered.map((row) => row.name.trim().toLowerCase()));
  for (const aspect of categoryAspects) {
    if (!aspect.required && !isOftenRequiredEbayAspectName(aspect.name)) continue;
    const key = aspect.name.trim().toLowerCase();
    if (existing.has(key)) continue;
    filtered.push({ name: aspect.name, value: "" });
    existing.add(key);
  }
  return filtered;
}
