/**
 * Etsy "How it's made" + taxonomy gates for INW→Etsy CREATE_LISTING.
 * Mirrors Etsy Shop Manager required fields (who / what / when + taxonomy).
 */

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

export type EtsyHowItsMadeInput = {
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  etsyIsSupply?: boolean | null;
  etsyTaxonomyId?: number | null;
  /** Connection/env fallback taxonomy when listing omits one. */
  defaultTaxonomyId?: number | null;
  inventoryTracking?: string | null;
};

export type EtsyHowItsMadeReady = {
  ok: true;
  whoMade: EtsyWhoMade;
  whenMade: EtsyWhenMade;
  isSupply: boolean;
  taxonomyId: number;
};

export type EtsyHowItsMadeMissing = {
  ok: false;
  code: "HOW_ITS_MADE_REQUIRED";
  missing: Array<"who_made" | "when_made" | "is_supply" | "taxonomy_id">;
  message: string;
};

export function isEtsyWhoMade(value: unknown): value is EtsyWhoMade {
  return typeof value === "string" && (ETSY_WHO_MADE_VALUES as readonly string[]).includes(value);
}

export function isEtsyWhenMade(value: unknown): value is EtsyWhenMade {
  return typeof value === "string" && (ETSY_WHEN_MADE_VALUES as readonly string[]).includes(value);
}

/**
 * Validate How it's made + taxonomy before enqueueing CREATE_LISTING.
 * Incomplete criteria fail closed — Etsy will reject publish without these.
 */
export function resolveEtsyHowItsMadeForCreate(
  input: EtsyHowItsMadeInput
): EtsyHowItsMadeReady | EtsyHowItsMadeMissing {
  const missing: EtsyHowItsMadeMissing["missing"] = [];

  const whoMade = isEtsyWhoMade(input.etsyWhoMade) ? input.etsyWhoMade : null;
  if (!whoMade) missing.push("who_made");

  let whenMade = isEtsyWhenMade(input.etsyWhenMade) ? input.etsyWhenMade : null;
  if (
    !whenMade &&
    typeof input.inventoryTracking === "string" &&
    input.inventoryTracking === "made_to_order"
  ) {
    whenMade = "made_to_order";
  }
  if (!whenMade) missing.push("when_made");

  const isSupply = typeof input.etsyIsSupply === "boolean" ? input.etsyIsSupply : null;
  if (isSupply == null) missing.push("is_supply");

  const taxonomyId =
    typeof input.etsyTaxonomyId === "number" &&
    Number.isInteger(input.etsyTaxonomyId) &&
    input.etsyTaxonomyId > 0
      ? input.etsyTaxonomyId
      : typeof input.defaultTaxonomyId === "number" &&
          Number.isInteger(input.defaultTaxonomyId) &&
          input.defaultTaxonomyId > 0
        ? input.defaultTaxonomyId
        : null;
  if (taxonomyId == null) missing.push("taxonomy_id");

  if (missing.length > 0 || !whoMade || !whenMade || isSupply == null || taxonomyId == null) {
    return {
      ok: false,
      code: "HOW_ITS_MADE_REQUIRED",
      missing,
      message:
        "Etsy requires How it's made (who made it, what it is, when it was made) and a taxonomy category before listing.",
    };
  }

  return {
    ok: true,
    whoMade,
    whenMade,
    isSupply,
    taxonomyId,
  };
}
