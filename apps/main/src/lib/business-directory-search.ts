/**
 * Support Local directory + seller search: expand queries to catalogue primaries/synonyms,
 * build Prisma OR fragments, and rank results by relevance.
 */
import type { Prisma } from "database";
import {
  BUSINESS_CATEGORIES,
  parseSubcategoriesByPrimary,
} from "@/lib/business-categories";
import { directorySearchCityTextVariants, normalizeKey, normalizeResidentCity } from "@/lib/city-utils";
import { DIRECTORY_SEARCH_SYNONYM_PRIMARIES } from "@/lib/business-directory-search-synonyms";
import { PREBUILT_CITIES } from "@/lib/prebuilt-cities";

/** Full query must be at least this long to run catalogue expansion. */
const MIN_QUERY_LEN = 2;
/** Substring match on label/sub (after word checks) needs this many chars to reduce false positives. */
const MIN_SUBSTRING_NEEDLE = 4;

export function normalizeSearchForMatching(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function segmentWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function tokensForExpansion(normalizedLower: string): string[] {
  const parts = normalizedLower.split(/\s+/).filter((t) => t.length >= MIN_QUERY_LEN);
  const out = new Set<string>();
  if (normalizedLower.length >= MIN_QUERY_LEN) out.add(normalizedLower);
  for (const p of parts) {
    if (p.length >= MIN_QUERY_LEN) out.add(p);
  }
  return [...out];
}

function labelMatchesNeedle(label: string, needle: string): boolean {
  const labelL = label.toLowerCase();
  const n = needle.toLowerCase();
  if (labelL === n) return true;
  if (segmentWords(label).some((seg) => seg === n)) return true;
  if (n.length < MIN_SUBSTRING_NEEDLE) return false;
  return labelL.includes(n);
}

function subMatchesNeedle(sub: string, needle: string): boolean {
  const subL = sub.toLowerCase();
  const n = needle.toLowerCase();
  if (subL === n) return true;
  if (segmentWords(sub).some((seg) => seg === n)) return true;
  if (n.length < MIN_SUBSTRING_NEEDLE) return false;
  return subL.includes(n);
}

/**
 * Primary category labels to OR against `categories: { has: label }` (exact DB strings).
 */
export function expandMatchingPrimaryLabels(searchTrimmed: string): string[] {
  const normalized = normalizeSearchForMatching(searchTrimmed);
  if (normalized.length < MIN_QUERY_LEN) return [];
  const lower = normalized.toLowerCase();
  const needles = tokensForExpansion(lower);
  const out = new Set<string>();

  for (const syn of DIRECTORY_SEARCH_SYNONYM_PRIMARIES) {
    if (syn.test(lower)) {
      for (const p of syn.primaries) out.add(p);
    }
  }

  for (const needle of needles) {
    for (const { label, subcategories } of BUSINESS_CATEGORIES) {
      if (labelMatchesNeedle(label, needle)) out.add(label);
      for (const sub of subcategories) {
        if (subMatchesNeedle(sub, needle)) out.add(label);
      }
    }
  }

  return [...out];
}

/** True when the query should match HVAC trade listings (synonyms + catalogue). */
export function isHvacDirectorySearchIntent(searchTrimmed: string): boolean {
  return expandMatchingPrimaryLabels(searchTrimmed).includes("HVAC");
}

/**
 * Many HVAC contractors use "… Heating … Air …" in the business name but pick a different
 * primary category (e.g. Appliance). Add OR branches so "hvac" still finds them.
 */
function appendHvacTradeNameSearchClauses(clauses: Prisma.BusinessWhereInput[]): void {
  const mode = "insensitive" as const;
  const pairs: [string, string][] = [
    ["Heating", "Air"],
    ["Heating", "Cooling"],
  ];
  const fields = ["name", "shortDescription", "fullDescription"] as const;
  for (const field of fields) {
    for (const [a, b] of pairs) {
      clauses.push({
        AND: [
          { [field]: { contains: a, mode } },
          { [field]: { contains: b, mode } },
        ],
      } as Prisma.BusinessWhereInput);
    }
  }
  for (const field of fields) {
    clauses.push({ [field]: { contains: "Air Conditioning", mode } } as Prisma.BusinessWhereInput);
  }
}

export function buildBusinessDirectorySearchWhere(
  search: string | undefined | null
): Prisma.BusinessWhereInput | undefined {
  const s = normalizeSearchForMatching(search ?? "");
  if (!s) return undefined;
  const mode = "insensitive" as const;
  const clauses: Prisma.BusinessWhereInput[] = [
    { name: { contains: s, mode } },
    { shortDescription: { contains: s, mode } },
    { fullDescription: { contains: s, mode } },
    { city: { contains: s, mode } },
    { address: { contains: s, mode } },
  ];
  for (const p of expandMatchingPrimaryLabels(s)) {
    clauses.push({ categories: { has: p } });
  }
  for (const v of directorySearchCityTextVariants(s)) {
    clauses.push({ city: { contains: v, mode } });
  }
  if (isHvacDirectorySearchIntent(s)) {
    appendHvacTradeNameSearchClauses(clauses);
  }
  return { OR: clauses };
}

export interface DirectorySearchScoreRow {
  name: string;
  shortDescription: string | null;
  fullDescription?: string | null;
  city: string | null;
  address: string | null;
  categories: string[];
  subcategoriesByPrimary?: unknown;
}

/** True when the query string appears literally in name, descriptions, city, or address. */
export function directorySearchIsDirectLiteralMatch(
  row: DirectorySearchScoreRow,
  searchTrimmed: string
): boolean {
  const s = normalizeSearchForMatching(searchTrimmed);
  if (!s) return true;
  const q = s.toLowerCase();
  const blob = [
    row.name,
    row.shortDescription ?? "",
    row.fullDescription ?? "",
    row.city ?? "",
    row.address ?? "",
  ]
    .join("\n")
    .toLowerCase();
  if (blob.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length > 1 && tokens.every((t) => blob.includes(t))) return true;
  return false;
}

function rowMatchesHvacTradeNamePatterns(row: DirectorySearchScoreRow): boolean {
  const name = row.name.toLowerCase();
  const sd = (row.shortDescription ?? "").toLowerCase();
  const fd = (row.fullDescription ?? "").toLowerCase();
  const bag = `${name}\n${sd}\n${fd}`;
  const hasPair = (a: string, b: string) => bag.includes(a) && bag.includes(b);
  return (
    hasPair("heating", "air") ||
    hasPair("heating", "cooling") ||
    bag.includes("air conditioning")
  );
}

/**
 * Matched via synonym/category expansion or HVAC trade-name patterns, without literal query text in listing fields.
 */
export function directorySearchIsSimilarExpansionMatch(
  row: DirectorySearchScoreRow,
  searchTrimmed: string
): boolean {
  const s = normalizeSearchForMatching(searchTrimmed);
  if (!s) return false;
  if (directorySearchIsDirectLiteralMatch(row, s)) return false;
  const expanded = new Set(expandMatchingPrimaryLabels(s));
  for (const c of row.categories ?? []) {
    if (expanded.has(c)) return true;
  }
  if (isHvacDirectorySearchIntent(s) && rowMatchesHvacTradeNamePatterns(row)) return true;
  return false;
}

/** UI hint: discretionary "similar" match for directory cards. */
export function computeDirectorySearchMatchNote(
  row: DirectorySearchScoreRow,
  searchTrimmed: string
): "similar" | undefined {
  return directorySearchIsSimilarExpansionMatch(row, searchTrimmed) ? "similar" : undefined;
}

export function scoreDirectorySearchMatch(row: DirectorySearchScoreRow, searchTrimmed: string): number {
  const s = normalizeSearchForMatching(searchTrimmed);
  if (!s) return 0;
  const lower = s.toLowerCase();
  const nameL = row.name.toLowerCase();
  let score = 0;

  if (nameL === lower) score += 200;
  else if (nameL.startsWith(lower)) score += 120;
  else if (nameL.includes(lower)) score += 90;

  const expandedPrimaries = new Set(expandMatchingPrimaryLabels(s));
  for (const c of row.categories ?? []) {
    if (expandedPrimaries.has(c)) score += 72;
    else if (c.toLowerCase().includes(lower)) score += 58;
  }

  const subMap = parseSubcategoriesByPrimary(row.subcategoriesByPrimary);
  for (const subs of Object.values(subMap)) {
    for (const sub of subs) {
      const subL = sub.toLowerCase();
      if (subL.includes(lower)) score += 52;
      for (const t of tokensForExpansion(lower)) {
        if (t !== lower && subL.includes(t)) score += 28;
      }
    }
  }

  const short = (row.shortDescription ?? "").toLowerCase();
  const full = (row.fullDescription ?? "").toLowerCase();
  if (short.includes(lower)) score += 46;
  if (full.includes(lower)) score += 36;

  if (expandedPrimaries.has("HVAC")) {
    const nameHeatingAir = nameL.includes("heating") && nameL.includes("air");
    const nameHeatingCool = nameL.includes("heating") && nameL.includes("cooling");
    if (nameHeatingAir || nameHeatingCool) score += 88;
    else if (
      (short.includes("heating") && short.includes("air")) ||
      (full.includes("heating") && full.includes("air"))
    ) {
      score += 65;
    } else if (short.includes("air conditioning") || full.includes("air conditioning")) {
      score += 60;
    }
  }

  for (const t of tokensForExpansion(lower)) {
    if (t === lower) continue;
    if (nameL.includes(t)) score += 25;
    if (short.includes(t)) score += 18;
    if (full.includes(t)) score += 14;
  }

  if ((row.city ?? "").toLowerCase().includes(lower)) score += 20;
  if ((row.address ?? "").toLowerCase().includes(lower)) score += 15;

  return score;
}

export function sortByDirectorySearchRelevance<T extends DirectorySearchScoreRow>(
  rows: T[],
  searchTrimmed: string
): T[] {
  const s = normalizeSearchForMatching(searchTrimmed);
  if (!s) {
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...rows].sort((a, b) => {
    const da = scoreDirectorySearchMatch(a, s);
    const db = scoreDirectorySearchMatch(b, s);
    if (db !== da) return db - da;
    return a.name.localeCompare(b.name);
  });
}

function buildCityKeyToDisplay(directoryDisplays: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of directoryDisplays) {
    const key = normalizeKey(d);
    if (!m.has(key)) m.set(key, d);
  }
  return m;
}

function resolveDirectoryOrPrebuiltCity(
  candidateRaw: string,
  directoryKeyToDisplay: Map<string, string>
): string | undefined {
  const rest = candidateRaw.trim();
  if (!rest) return undefined;
  const firstSegment = rest.split(",")[0]!.trim();
  const normalized = normalizeResidentCity(firstSegment);
  const key = normalizeKey(normalized);
  const fromDir = directoryKeyToDisplay.get(key);
  if (fromDir) return fromDir;
  const pre = PREBUILT_CITIES.find((c) => normalizeKey(c) === key);
  if (pre) return pre;
  return undefined;
}

/**
 * Parse combined queries like "Tattoos in Hayden" into service text + implied city filter.
 * Only applies when the tail resolves to a directory city or {@link PREBUILT_CITIES} entry.
 */
export function splitSearchQueryWithImpliedCity(
  rawSearch: string,
  directoryCityDisplays: readonly string[]
): { textSearch: string; impliedCity: string | undefined } {
  const full = normalizeSearchForMatching(rawSearch);
  if (!full) return { textSearch: "", impliedCity: undefined };

  const map = buildCityKeyToDisplay(directoryCityDisplays);
  const m = full.match(/^(.+?)\s+(?:in|near|around|at)\s+(.+)$/i);
  if (!m) return { textSearch: full, impliedCity: undefined };

  const left = m[1]!.trim();
  const cityRaw = m[2]!.trim();
  const city = resolveDirectoryOrPrebuiltCity(cityRaw, map);
  if (!city) return { textSearch: full, impliedCity: undefined };

  return { textSearch: left, impliedCity: city };
}
