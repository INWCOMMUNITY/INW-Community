import type { BusinessCategoryOption } from "@/lib/business-categories";

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "our",
  "your",
  "from",
  "that",
  "this",
  "are",
  "you",
  "all",
  "any",
  "can",
  "has",
  "have",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Score preset relevance to business descriptions + search (higher = better). */
export function scorePresetForDescriptions(
  preset: BusinessCategoryOption,
  shortDescription: string,
  fullDescription: string,
  searchQuery: string
): number {
  const blob = `${shortDescription} ${fullDescription} ${searchQuery}`;
  const tokens = new Set(tokenize(blob));
  if (tokens.size === 0) return 0;
  let score = 0;
  for (const w of tokenize(preset.label)) {
    if (tokens.has(w)) score += 4;
  }
  for (const sub of preset.subcategories) {
    for (const w of tokenize(sub)) {
      if (tokens.has(w)) score += 1;
    }
  }
  return score;
}

export function filterBusinessCategoryPresets(
  presets: BusinessCategoryOption[],
  query: string
): BusinessCategoryOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;
  return presets.filter(
    (p) =>
      p.label.toLowerCase().includes(q) ||
      p.subcategories.some((s) => s.toLowerCase().includes(q))
  );
}

export function recommendedBusinessCategoryPresets(
  presets: BusinessCategoryOption[],
  shortDescription: string,
  fullDescription: string,
  searchQuery: string,
  limit = 6
): BusinessCategoryOption[] {
  const scored = presets
    .map((p) => ({
      p,
      s: scorePresetForDescriptions(p, shortDescription, fullDescription, searchQuery),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const out: BusinessCategoryOption[] = [];
  const seen = new Set<string>();
  for (const { p } of scored) {
    if (seen.has(p.label)) continue;
    seen.add(p.label);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
