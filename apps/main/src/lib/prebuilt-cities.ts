/**
 * Prebuilt cities for businesses and event calendars.
 * Users can search/filter these or add a custom city.
 */
export const PREBUILT_CITIES = [
  "Spokane",
  "Spokane Valley",
  "Airway Heights",
  "Liberty Lake",
  "Newport",
  "Otis Orchards",
  "Deer Park",
  "Post Falls",
  "Hayden",
  "Coeur d'Alene",
  "Rathdrum",
  "Athol",
  "Wallace",
  "Kellogg",
  "Moscow",
] as const;

export type PrebuiltCity = (typeof PREBUILT_CITIES)[number];

/** Filter prebuilt cities by search (case-insensitive). */
export function filterPrebuiltCities(search: string): string[] {
  const q = search.trim().toLowerCase();
  if (!q) return [...PREBUILT_CITIES];
  return PREBUILT_CITIES.filter((c) => c.toLowerCase().includes(q));
}
