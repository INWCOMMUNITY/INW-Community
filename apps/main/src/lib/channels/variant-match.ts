/**
 * Canonical variant-row matching shared by every channel adapter (both directions).
 *
 * The recurring variant-price bug across Etsy/eBay/Wix/Shopify was that each adapter
 * matched an INW SKU row to a remote row differently — usually with `optionsEqual`,
 * which requires the option *axis names* (keys) to be identical. Providers rename axes
 * (Wix collapses array choices to `"Option"`, Etsy uses `property_name`, Shopify uses
 * positional `option1/2/3`), so the match silently fails and the caller falls back to
 * the listing/min price — flattening every variation to one price.
 *
 * This module matches by, in order of confidence:
 *   1. exact SKU code (normalized)
 *   2. option VALUES (name-agnostic multiset) — handles axis-name/casing/order drift
 *   3. positional (only when the product is a single combination, so it is unambiguous)
 *
 * Callers should treat `quality === "none"` as "do not touch this row's price" so a
 * mismatch can never cause a flatten.
 */

import type { VariantMatrix, VariantSkuRow } from "@/lib/listing-variant-matrix";

export type VariantMatchQuality = "sku" | "values" | "positional" | "none";

export type VariantMatchResult = {
  row: VariantSkuRow | null;
  quality: VariantMatchQuality;
};

/** A remote variation row reduced to the two things we can match on. */
export type RemoteVariantRef = {
  sku?: string | null;
  options?: Record<string, string> | null;
};

function normalizeSku(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Order/axis-name-independent key built from option VALUES only (case-insensitive).
 * `{ Size: "L", Color: "Brown" }` and `{ Option: "brown", foo: "l" }` produce the
 * same key, so a provider that renames axes still matches.
 */
export function optionValueSetKey(options: Record<string, string> | null | undefined): string {
  if (!options) return "";
  const values = Object.values(options)
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return values.join("\u0001");
}

/**
 * True when two option selections refer to the same combination, regardless of axis
 * names. Falls back to a value-multiset comparison so `{ Option: "brown" }` matches
 * `{ Color: "Brown" }`. Empty on either side is never a match.
 */
export function variantOptionsMatch(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined
): boolean {
  const keyA = optionValueSetKey(a);
  const keyB = optionValueSetKey(b);
  if (!keyA || !keyB) return false;
  return keyA === keyB;
}

/**
 * Find the INW SKU row that corresponds to a remote variation row.
 * Returns the matched row plus a quality so callers can decide how much to trust it.
 *
 * @param opts.allowPositional match a single-combination product even when values do
 *   not line up (safe only when there is exactly one INW row).
 */
export function matchInwSkuRow(
  matrix: VariantMatrix,
  remote: RemoteVariantRef,
  opts?: { allowPositional?: boolean }
): VariantMatchResult {
  if (!matrix || matrix.skus.length === 0) return { row: null, quality: "none" };

  // 1. Exact SKU code.
  const wantSku = normalizeSku(remote.sku);
  if (wantSku) {
    const bySku = matrix.skus.find((s) => normalizeSku(s.sku) === wantSku);
    if (bySku) return { row: bySku, quality: "sku" };
  }

  // 2. Option values (name-agnostic).
  const wantKey = optionValueSetKey(remote.options);
  if (wantKey) {
    const byValues = matrix.skus.find((s) => optionValueSetKey(s.options) === wantKey);
    if (byValues) return { row: byValues, quality: "values" };
  }

  // 3. Positional — only unambiguous for a single-combination product.
  if (opts?.allowPositional && matrix.skus.length === 1) {
    return { row: matrix.skus[0], quality: "positional" };
  }

  return { row: null, quality: "none" };
}

/**
 * Reverse lookup: given an INW SKU row, find the matching remote row.
 * Same confidence ladder (SKU code, then option values).
 */
export function matchRemoteRow<T extends RemoteVariantRef>(
  remoteRows: readonly T[],
  inwSku: VariantSkuRow,
  opts?: { allowPositional?: boolean }
): { row: T | null; quality: VariantMatchQuality } {
  if (remoteRows.length === 0) return { row: null, quality: "none" };

  const wantSku = normalizeSku(inwSku.sku);
  if (wantSku) {
    const bySku = remoteRows.find((r) => normalizeSku(r.sku) === wantSku);
    if (bySku) return { row: bySku, quality: "sku" };
  }

  const wantKey = optionValueSetKey(inwSku.options);
  if (wantKey) {
    const byValues = remoteRows.find((r) => optionValueSetKey(r.options) === wantKey);
    if (byValues) return { row: byValues, quality: "values" };
  }

  if (opts?.allowPositional && remoteRows.length === 1) {
    return { row: remoteRows[0], quality: "positional" };
  }

  return { row: null, quality: "none" };
}
