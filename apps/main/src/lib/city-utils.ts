import { PREBUILT_CITIES } from "./prebuilt-cities";

/**
 * Canonical city names for deduplication. Maps lowercase normalized form → display form.
 * Use when cities from DB may have variants (e.g. "Coeur D'Alene" vs "Coeur d'Alene").
 */
const CANONICAL_CITIES: Record<string, string> = {
  cda: "Coeur d'Alene",
  "coeur d alene": "Coeur d'Alene",
  "coeur d'alene": "Coeur d'Alene",
  "coeur d''alene": "Coeur d'Alene",
};

export function normalizeKey(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[''`´]/g, "'");
}

/**
 * Normalize city from signup forms, CityPicker custom entry, or API body.
 * Uses the same prebuilt list as business/event forms plus aliases (e.g. CDA → Coeur d'Alene).
 */
export function normalizeResidentCity(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return s;
  const key = normalizeKey(s);
  const canonical = CANONICAL_CITIES[key];
  if (canonical) return canonical;
  const prebuilt = PREBUILT_CITIES.find((c) => normalizeKey(c) === key);
  if (prebuilt) return prebuilt;
  return s;
}

/**
 * Parse a business `city` field (often "Post Falls, ID 83854, USA") into a directory display
 * name ("Post Falls"). Strips trailing country, US state, and ZIP; keeps multi-part city names
 * (e.g. "Coeur d'Alene") when they are the only segment left.
 */
export function extractBusinessDisplayCity(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/,?\s*(USA|United States)\s*$/i, "").trim();
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const stateZip = /^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i;
  const stateOnly = /^[A-Z]{2}$/i;
  while (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    if (stateZip.test(last) || stateOnly.test(last)) {
      parts.pop();
      continue;
    }
    break;
  }
  if (parts.length === 0) return null;
  const joined = parts.join(", ").trim();
  if (!joined) return null;
  const key = normalizeKey(joined);
  return CANONICAL_CITIES[key] ?? joined;
}

/** Whether a stored city value represents the same directory city as the filter chip value. */
export function businessDisplayCityEquals(
  storedCity: string | null | undefined,
  filterDisplayCity: string | null | undefined
): boolean {
  const a = extractBusinessDisplayCity(storedCity);
  const b = extractBusinessDisplayCity(filterDisplayCity);
  if (!a || !b) return false;
  return normalizeKey(a) === normalizeKey(b);
}

/**
 * Unique sorted directory city labels from raw DB values (no duplicate metros from "City" vs
 * "City, ID 83854, USA").
 */
export function deduplicateCities(cities: (string | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of cities) {
    const display = extractBusinessDisplayCity(c);
    if (!display) continue;
    const key = normalizeKey(display);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(CANONICAL_CITIES[key] ?? display);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
