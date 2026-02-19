/**
 * Canonical city names for deduplication. Maps lowercase normalized form → display form.
 * Use when cities from DB may have variants (e.g. "Coeur D'Alene" vs "Coeur d'Alene").
 */
const CANONICAL_CITIES: Record<string, string> = {
  "coeur d'alene": "Coeur d'Alene",
  "coeur d''alene": "Coeur d'Alene",
};

function normalizeKey(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/[''`´]/g, "'");
}

/**
 * Deduplicate cities using case-insensitive + apostrophe normalization.
 * Known variants (e.g. Coeur d'Alene) are mapped to a single canonical form.
 */
export function deduplicateCities(cities: (string | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of cities) {
    const city = (c ?? "").trim();
    if (!city) continue;
    const key = normalizeKey(city);
    const canonical = CANONICAL_CITIES[key] ?? city;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result.sort();
}
