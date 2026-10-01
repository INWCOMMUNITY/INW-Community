import { ETSY_PLATFORM_DEFAULT_TAXONOMY_ID } from "./apps-airport";

/** Connection → env → platform silent fallback for Etsy taxonomy_id. */
export function resolveEtsyTaxonomyFallback(
  connectionDefault: number | null | undefined
): number {
  if (
    typeof connectionDefault === "number" &&
    Number.isInteger(connectionDefault) &&
    connectionDefault > 0
  ) {
    return connectionDefault;
  }
  if (
    typeof process.env.ETSY_DEFAULT_TAXONOMY_ID === "string" &&
    /^\d+$/.test(process.env.ETSY_DEFAULT_TAXONOMY_ID.trim())
  ) {
    return Number.parseInt(process.env.ETSY_DEFAULT_TAXONOMY_ID.trim(), 10);
  }
  return ETSY_PLATFORM_DEFAULT_TAXONOMY_ID;
}
