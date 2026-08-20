import type { CalendarType } from "types";
import { CALENDAR_TYPES } from "types";

const SHORT_LABELS: Record<CalendarType, string> = {
  fun_events: "Fun Events",
  local_art_music: "Art & Music",
  non_profit: "Non-Profit",
  business_promotional: "Community",
  marketing: "Marketing",
  real_estate: "Real Estate",
};

const DESCRIPTIONS: Record<CalendarType, string> = {
  fun_events: "Fairs, festivals, and things to do around Spokane and Kootenai County.",
  local_art_music: "Galleries, concerts, and nights out for art and music.",
  non_profit: "Fundraisers, volunteer days, and community causes.",
  business_promotional: "Open houses, pop-ups, and local business happenings.",
  marketing: "Workshops, mixers, and marketing meetups.",
  real_estate: "Open houses, tours, and real estate events.",
};

export function shortCalendarLabel(value: string): string {
  if (value in SHORT_LABELS) return SHORT_LABELS[value as CalendarType];
  const full = CALENDAR_TYPES.find((c) => c.value === value)?.label ?? value;
  return full.replace(/\s+Calendar$/i, "").replace(/\s+Events$/i, "") || full;
}

export function calendarDescription(value: string): string {
  if (value in DESCRIPTIONS) return DESCRIPTIONS[value as CalendarType];
  return "Events happening around Spokane and Kootenai County.";
}

/** Marketing photo is framed at the top of the frame; others stay centered. */
export function calendarImageObjectClass(value: string): string {
  return value === "marketing" ? "object-top" : "object-center";
}
