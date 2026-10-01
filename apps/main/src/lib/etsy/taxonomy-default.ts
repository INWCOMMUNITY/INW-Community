import {
  ETSY_KNOWN_INVALID_TAXONOMY_IDS,
  ETSY_PLATFORM_DEFAULT_TAXONOMY_ID,
} from "./apps-airport";

function isPlausibleEtsyTaxonomyId(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value > 0 &&
    value < 10_000_000 &&
    !ETSY_KNOWN_INVALID_TAXONOMY_IDS.has(value)
  );
}

/** Drop null/non-integer/known-bad taxonomy ids. */
export function sanitizeEtsyTaxonomyId(value: number | null | undefined): number | null {
  return typeof value === "number" && isPlausibleEtsyTaxonomyId(value) ? value : null;
}

/** Connection → env → platform silent fallback for Etsy taxonomy_id. */
export function resolveEtsyTaxonomyFallback(
  connectionDefault: number | null | undefined
): number {
  const fromConnection = sanitizeEtsyTaxonomyId(connectionDefault);
  if (fromConnection != null) return fromConnection;
  if (
    typeof process.env.ETSY_DEFAULT_TAXONOMY_ID === "string" &&
    /^\d+$/.test(process.env.ETSY_DEFAULT_TAXONOMY_ID.trim())
  ) {
    const fromEnv = sanitizeEtsyTaxonomyId(
      Number.parseInt(process.env.ETSY_DEFAULT_TAXONOMY_ID.trim(), 10)
    );
    if (fromEnv != null) return fromEnv;
  }
  return ETSY_PLATFORM_DEFAULT_TAXONOMY_ID;
}
