/** Keep in sync with apps/main/src/lib/etsy-listing-options.ts.
 * Values must be valid Etsy Open API `when_made` / `who_made` enums. */

export const ETSY_WHO_MADE_OPTIONS = [
  { value: "i_did", label: "I did" },
  { value: "someone_else", label: "Another company or person" },
  { value: "collective", label: "A member of my shop" },
] as const;

export const ETSY_WHEN_MADE_OPTIONS = [
  { value: "made_to_order", label: "Made to order" },
  { value: "2020_2026", label: "2020–2026" },
  { value: "2010_2019", label: "2010–2019" },
  { value: "2007_2009", label: "2007–2009" },
  { value: "before_2007", label: "Before 2007" },
  { value: "2000_2006", label: "2000–2006" },
  { value: "1990s", label: "1990s" },
  { value: "1980s", label: "1980s" },
  { value: "1970s", label: "1970s" },
  { value: "1960s", label: "1960s" },
  { value: "1950s", label: "1950s" },
  { value: "before_1700", label: "Before 1700" },
] as const;

export type EtsyWhoMade = (typeof ETSY_WHO_MADE_OPTIONS)[number]["value"];
export type EtsyWhenMade = (typeof ETSY_WHEN_MADE_OPTIONS)[number]["value"];

const WHO_MADE_VALUES = new Set<string>(ETSY_WHO_MADE_OPTIONS.map((o) => o.value));
const WHEN_MADE_VALUES = new Set<string>(ETSY_WHEN_MADE_OPTIONS.map((o) => o.value));

/** Stored form/API values that are no longer in Etsy's enum. */
const LEGACY_WHEN_MADE: Record<string, EtsyWhenMade> = {
  "2020_2025": "2020_2026",
  "2004_2009": "2007_2009",
  before_2004: "before_2007",
  "2000_2003": "2000_2006",
  "2006_2009": "2007_2009",
  before_2006: "before_2007",
  "2000_2005": "2000_2006",
  before_1960: "1950s",
};

export function isEtsyWhoMade(value: string | null | undefined): value is EtsyWhoMade {
  return !!value && WHO_MADE_VALUES.has(value);
}

export function normalizeEtsyWhenMade(value: string | null | undefined): EtsyWhenMade | null {
  if (!value) return null;
  if (WHEN_MADE_VALUES.has(value)) return value as EtsyWhenMade;
  return LEGACY_WHEN_MADE[value] ?? null;
}

export function etsyWhenMadeLabel(value: EtsyWhenMade): string {
  return ETSY_WHEN_MADE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
