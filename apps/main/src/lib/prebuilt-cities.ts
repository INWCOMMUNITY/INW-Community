/**
 * Prebuilt cities for businesses and event calendars.
 * Users can search/filter these or add a custom city.
 */
export const PREBUILT_CITIES = [
  "Airway Heights",
  "Athol",
  "Coeur d'Alene",
  "Deer Park",
  "Hayden",
  "Kellogg",
  "Liberty Lake",
  "Moscow",
  "Newport",
  "Otis Orchards",
  "Post Falls",
  "Rathdrum",
  "Spokane",
  "Spokane Valley",
  "Wallace",
] as const;

export type PrebuiltCity = (typeof PREBUILT_CITIES)[number];

/** Filter prebuilt cities by search (case-insensitive). */
export function filterPrebuiltCities(search: string): string[] {
  const q = search.trim().toLowerCase();
  const matches = !q
    ? [...PREBUILT_CITIES]
    : PREBUILT_CITIES.filter((c) => c.toLowerCase().includes(q));
  return matches.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
