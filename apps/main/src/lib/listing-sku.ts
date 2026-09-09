/** eBay Inventory API cap; Etsy/Wix/Shopify accept this length too. */
export const LISTING_SKU_MAX = 50;

/** eBay migrated inventory keys like inw403004607151 — not a seller custom SKU. */
const EBAY_MIGRATION_SKU = /^inw\d+$/i;

export function normalizeListingSku(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim().slice(0, LISTING_SKU_MAX);
  return trimmed || null;
}

export function isEbayMigrationSku(sku: string | null | undefined): boolean {
  return Boolean(sku && EBAY_MIGRATION_SKU.test(sku.trim()));
}

/**
 * Shopify cartesian fallbacks look like `{itemId}-Purple`. Those must not become
 * the parent StoreItem SKU — eBay then rejects the hyphen and misses the listing.
 */
export function isGeneratedVariantOfItemId(sku: string, itemId: string): boolean {
  const id = itemId.trim();
  const s = sku.trim();
  if (!id || !s) return false;
  if (s === id) return true;
  if (s.startsWith(`${id}-`) || s.startsWith(`${id}_`)) return true;
  const a = s.replace(/[^a-zA-Z0-9]/g, "");
  const b = id.replace(/[^a-zA-Z0-9]/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  return b.length >= 8 && a.startsWith(b) && a.length > b.length;
}

/**
 * Fill an empty INW SKU from a channel listing. Skips the item id and eBay
 * migration keys so inbound sync does not overwrite a blank box with internals.
 */
export function skuToAdoptFromRemote(args: {
  localSku: string | null | undefined;
  remoteSku: string | null | undefined;
  itemId: string;
}): string | null {
  if (normalizeListingSku(args.localSku)) return null;
  const sku = normalizeListingSku(args.remoteSku);
  if (!sku || sku === args.itemId || isEbayMigrationSku(sku)) return null;
  if (isGeneratedVariantOfItemId(sku, args.itemId)) return null;
  return sku;
}
