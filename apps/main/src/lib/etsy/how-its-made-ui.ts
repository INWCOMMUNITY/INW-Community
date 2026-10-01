/** Client-safe Etsy How it's made labels (mirrors packages/database/src/etsy/how-its-made.ts). */

export const ETSY_WHO_MADE_VALUES = ["i_did", "someone_else", "collective"] as const;
export type EtsyWhoMade = (typeof ETSY_WHO_MADE_VALUES)[number];

export const ETSY_WHEN_MADE_VALUES = [
  "made_to_order",
  "2020_2026",
  "2010_2019",
  "2007_2009",
  "before_2007",
  "2000_2006",
  "1990s",
  "1980s",
  "1970s",
  "1960s",
  "1950s",
  "1940s",
  "1930s",
  "1920s",
  "1910s",
  "1900s",
  "1800s",
  "1700s",
  "before_1700",
] as const;
export type EtsyWhenMade = (typeof ETSY_WHEN_MADE_VALUES)[number];

export const ETSY_WHO_MADE_LABELS: Record<EtsyWhoMade, string> = {
  i_did: "I did",
  collective: "A member of my shop",
  someone_else: "Another company or person",
};

export const ETSY_WHEN_MADE_LABELS: Record<EtsyWhenMade, string> = {
  made_to_order: "Made to order",
  "2020_2026": "2020–2026",
  "2010_2019": "2010–2019",
  "2007_2009": "2007–2009",
  before_2007: "Before 2007",
  "2000_2006": "2000–2006",
  "1990s": "1990s",
  "1980s": "1980s",
  "1970s": "1970s",
  "1960s": "1960s",
  "1950s": "1950s",
  "1940s": "1940s",
  "1930s": "1930s",
  "1920s": "1920s",
  "1910s": "1910s",
  "1900s": "1900s",
  "1800s": "1800s",
  "1700s": "1700s",
  before_1700: "Before 1700",
};
