/** Cities in Eastern Washington and Northern Idaho (NWC region). "All cities" for filter only. */
export const EVENT_CITIES = [
  "All cities",
  "Spokane",
  "Spokane Valley",
  "Coeur d'Alene",
  "Post Falls",
  "Liberty Lake",
  "Cheney",
  "Hayden",
  "Rathdrum",
  "Moscow",
  "Pullman",
  "Sandpoint",
  "Kellogg",
  "Lewiston",
  "Clarkston",
  "Other",
] as const;

export type EventCity = (typeof EVENT_CITIES)[number];

/** Cities for event form (excludes "All cities"). */
export const EVENT_CITIES_FORM = EVENT_CITIES.filter((c) => c !== "All cities");

export const CALENDAR_TYPES = [
  { value: "fun_events", label: "Fun Events Calendar" },
  { value: "local_art_music", label: "Local Art & Music Calendar" },
  { value: "non_profit", label: "Non-Profit Events Calendar" },
  { value: "business_promotional", label: "Business Promotional Events" },
  { value: "marketing", label: "Marketing Events" },
  { value: "real_estate", label: "Real Estate Events" },
] as const;

export type CalendarType = (typeof CALENDAR_TYPES)[number]["value"];

const CALENDAR_IMAGES: Record<CalendarType, number> = {
  fun_events: require("@/assets/images/calendars/fun_events.png"),
  local_art_music: require("@/assets/images/calendars/local_art_music.png"),
  non_profit: require("@/assets/images/calendars/non_profit.png"),
  business_promotional: require("@/assets/images/calendars/business_promotional.png"),
  marketing: require("@/assets/images/calendars/marketing.png"),
  real_estate: require("@/assets/images/calendars/real_estate.png"),
};

export function getCalendarImage(type: CalendarType): number {
  return CALENDAR_IMAGES[type];
}
