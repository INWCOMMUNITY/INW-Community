/** Identity for cart lines: same listing + same options (+ same fulfillment + same custom answers) merge; different SKUs stay separate. */

import { buyerResponsesFingerprint } from "database/src/buyer-response-fingerprint";

export type CartLineIdentity = {
  storeItemId: string;
  variant?: unknown;
  fulfillmentType?: string | null;
  resaleOfferId?: string | null;
  buyerResponses?: unknown;
};

export type CartLineQty = CartLineIdentity & {
  id?: string;
  quantity: number;
};

/** Stable key for a selected option map so key order and casing do not split the same SKU. */
export function cartVariantFingerprint(variant: unknown): string {
  if (variant == null || typeof variant !== "object" || Array.isArray(variant)) return "";
  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries(variant as Record<string, unknown>)) {
    if (v == null) continue;
    const key = k.trim().toLowerCase();
    const val = String(v).trim().toLowerCase();
    if (!key || !val) continue;
    pairs.push([key, val]);
  }
  if (pairs.length === 0) return "";
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("|");
}

export function cartFulfillmentKey(type: string | null | undefined): string {
  const t = type?.trim();
  return t || "ship";
}

/** Same purchasable SKU (stock is shared across ship / pickup / delivery). */
export function cartLinesAreSameSku(
  a: { storeItemId: string; variant?: unknown },
  b: { storeItemId: string; variant?: unknown }
): boolean {
  return a.storeItemId === b.storeItemId && cartVariantFingerprint(a.variant) === cartVariantFingerprint(b.variant);
}

/** Exact cart row: same SKU, fulfillment, and offer lock (if any). */
export function cartLinesAreSameItem(a: CartLineIdentity, b: CartLineIdentity): boolean {
  if (a.storeItemId !== b.storeItemId) return false;
  if ((a.resaleOfferId ?? null) !== (b.resaleOfferId ?? null)) return false;
  if (cartFulfillmentKey(a.fulfillmentType) !== cartFulfillmentKey(b.fulfillmentType)) return false;
  if (buyerResponsesFingerprint(a.buyerResponses) !== buyerResponsesFingerprint(b.buyerResponses)) return false;
  return cartVariantFingerprint(a.variant) === cartVariantFingerprint(b.variant);
}

export function findMatchingCartLine<T extends CartLineIdentity>(lines: T[], target: CartLineIdentity): T | undefined {
  return lines.find((line) => cartLinesAreSameItem(line, target));
}

/**
 * Checkout payload does not send resaleOfferId; match listing + options + fulfillment.
 */
export function findCartRowForCheckoutLine<T extends CartLineIdentity>(
  lines: T[],
  target: {
    storeItemId: string;
    variant?: unknown;
    fulfillmentType?: string | null;
    buyerResponses?: unknown;
  }
): T | undefined {
  const exact = lines.find(
    (line) =>
      line.storeItemId === target.storeItemId &&
      cartFulfillmentKey(line.fulfillmentType) === cartFulfillmentKey(target.fulfillmentType) &&
      cartVariantFingerprint(line.variant) === cartVariantFingerprint(target.variant) &&
      buyerResponsesFingerprint(line.buyerResponses) === buyerResponsesFingerprint(target.buyerResponses)
  );
  if (exact) return exact;
  return lines.find(
    (line) =>
      line.storeItemId === target.storeItemId &&
      cartVariantFingerprint(line.variant) === cartVariantFingerprint(target.variant) &&
      buyerResponsesFingerprint(line.buyerResponses) === buyerResponsesFingerprint(target.buyerResponses)
  );
}

export function quantityOnSameSku(lines: CartLineQty[], target: { storeItemId: string; variant?: unknown }, excludeId?: string): number {
  return lines.reduce((sum, line) => {
    if (excludeId && line.id === excludeId) return sum;
    if (!cartLinesAreSameSku(line, target)) return sum;
    return sum + line.quantity;
  }, 0);
}

/** Every combination of a shared-quantity listing draws from one pool. */
export function quantityOnSameListing(
  lines: CartLineQty[],
  target: { storeItemId: string },
  excludeId?: string
): number {
  return lines.reduce((sum, line) => {
    if (excludeId && line.id === excludeId) return sum;
    if (line.storeItemId !== target.storeItemId) return sum;
    return sum + line.quantity;
  }, 0);
}

/** Max this line can be. Shared listings count every combination; other listings count the same options only. */
export function maxQuantityForCartLine(
  skuAvailable: number,
  lines: CartLineQty[],
  target: { id?: string; storeItemId: string; variant?: unknown },
  options?: { sharedQuantity?: boolean }
): number {
  const others = options?.sharedQuantity
    ? quantityOnSameListing(lines, target, target.id)
    : quantityOnSameSku(lines, target, target.id);
  return Math.max(0, skuAvailable - others);
}

export function formatCartVariantLabel(variant: unknown): string | null {
  if (variant == null || typeof variant !== "object" || Array.isArray(variant)) return null;
  const parts: [string, string][] = [];
  for (const [k, v] of Object.entries(variant as Record<string, unknown>)) {
    if (v == null) continue;
    const key = k.trim();
    const val = String(v).trim();
    if (key && val) parts.push([key, val]);
  }
  if (parts.length === 0) return null;
  parts.sort((a, b) => a[0].localeCompare(b[0]));
  return parts.map(([k, v]) => `${k}: ${v}`).join(", ");
}

export function cartSkuQuantityKey(storeItemId: string, variant: unknown): string {
  return `${storeItemId}::${cartVariantFingerprint(variant)}`;
}
