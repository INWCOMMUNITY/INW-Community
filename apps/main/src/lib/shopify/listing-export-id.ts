import { createHash } from "crypto";

/** App-owned product custom-ID metafield used as productSet upsert identity. */
export const SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE = "$app";
export const SHOPIFY_LISTING_EXPORT_METAFIELD_KEY = "listing_export_id";

/**
 * Generation-scoped deterministic custom ID.
 * Must include connection id so reconnect never adopts a prior generation's remote product by StoreItem alone.
 */
export function shopifyListingExportCustomId(connectionId: string, storeItemId: string): string {
  const digest = createHash("sha256")
    .update(`inw-shopify-listing-export\0${connectionId}\0${storeItemId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `inw_${digest}`;
}

export function shopifyCreateListingDedupeKey(connectionId: string, storeItemId: string): string {
  return `CREATE_LISTING:${connectionId}:${storeItemId}`;
}

export function centsToShopifyMoney(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, Math.trunc(cents)) : 0;
  return (safe / 100).toFixed(2);
}
