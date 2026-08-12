/** Keep in sync with apps/main/src/lib/channels/field-requirements.ts */

export const ETSY_WHO_MADE_OPTIONS = [
  { value: "i_did", label: "I did" },
  { value: "someone_else", label: "Another company or person" },
  { value: "collective", label: "A member of my shop" },
] as const;

export const ETSY_WHEN_MADE_OPTIONS = [
  { value: "made_to_order", label: "Made to order" },
  { value: "2020_2025", label: "2020–2025" },
  { value: "2010_2019", label: "2010–2019" },
  { value: "2004_2009", label: "2004–2009" },
  { value: "before_2004", label: "Before 2004" },
  { value: "2000_2003", label: "2000–2003" },
  { value: "1990s", label: "1990s" },
  { value: "1980s", label: "1980s" },
  { value: "1970s", label: "1970s" },
  { value: "1960s", label: "1960s" },
  { value: "before_1960", label: "Before 1960 (vintage)" },
] as const;

export type EtsyWhoMade = (typeof ETSY_WHO_MADE_OPTIONS)[number]["value"];
export type EtsyWhenMade = (typeof ETSY_WHEN_MADE_OPTIONS)[number]["value"];

const WHO_MADE_VALUES = new Set<string>(ETSY_WHO_MADE_OPTIONS.map((o) => o.value));
const WHEN_MADE_VALUES = new Set<string>(ETSY_WHEN_MADE_OPTIONS.map((o) => o.value));

/** Legacy mobile value before full Etsy option list shipped. */
const LEGACY_WHEN_MADE: Record<string, EtsyWhenMade> = {
  before_2006: "before_1960",
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
