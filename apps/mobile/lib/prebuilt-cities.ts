/** Prebuilt cities for businesses and event calendars (NWC region). */
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

export function filterPrebuiltCities(search: string): string[] {
  const q = search.trim().toLowerCase();
  const matches = !q
    ? [...PREBUILT_CITIES]
    : PREBUILT_CITIES.filter((c) => c.toLowerCase().includes(q));
  return matches.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
