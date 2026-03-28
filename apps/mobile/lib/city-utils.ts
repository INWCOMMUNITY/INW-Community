import { PREBUILT_CITIES } from "./prebuilt-cities";

/** Keep in sync with apps/main/src/lib/city-utils.ts (aliases + prebuilt matching). */
const CANONICAL_CITIES: Record<string, string> = {
  cda: "Coeur d'Alene",
  "coeur d alene": "Coeur d'Alene",
  "coeur d'alene": "Coeur d'Alene",
  "coeur d''alene": "Coeur d'Alene",
};

function normalizeKey(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[''`´]/g, "'");
}

/** Same rules as website CityPicker / resident signup API. */
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
