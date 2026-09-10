/**
 * Shopify inventory/update webhooks only tell us an `inventory_item_id`, not which product it
 * belongs to. The naive path fetched every linked product until it found the matching variant —
 * O(n) Admin API calls per webhook, which shreds the rate budget on large shops.
 *
 * We keep a durable `inventory_item_id -> product id` map in the connection config. Once an item
 * has been seen, future webhooks for it resolve to a single product fetch. The map is plain JSON
 * (bounded by the shop's variant count) so it needs no schema migration.
 */
export const SHOPIFY_INVENTORY_INDEX_KEY = "shopifyInventoryIndex";

export type ShopifyInventoryIndex = Record<string, string>;

/** Read the persisted inventory-item -> product-id map from a connection config blob. */
export function readShopifyInventoryIndex(config: unknown): ShopifyInventoryIndex {
  if (!config || typeof config !== "object") return {};
  const raw = (config as Record<string, unknown>)[SHOPIFY_INVENTORY_INDEX_KEY];
  if (!raw || typeof raw !== "object") return {};
  const out: ShopifyInventoryIndex = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
  }
  return out;
}

/** The product id previously indexed for this inventory item, if any. */
export function indexedProductIdForInventoryItem(
  config: unknown,
  inventoryItemId: number | string
): string | null {
  const index = readShopifyInventoryIndex(config);
  return index[String(inventoryItemId)] ?? null;
}

/**
 * Order links so the indexed product is tried first. The webhook loop returns on the first match,
 * so a correct index means a single Admin API call; a stale index still falls back to the scan.
 */
export function orderLinksByIndexedProduct<T extends { externalListingId: string | null }>(
  links: T[],
  productId: string | null
): T[] {
  if (!productId) return links;
  const idx = links.findIndex((l) => String(l.externalListingId) === String(productId));
  if (idx <= 0) return links;
  return [links[idx], ...links.slice(0, idx), ...links.slice(idx + 1)];
}

/** Return a new index with the item -> product mapping recorded (no-op when already correct). */
export function withShopifyInventoryIndexEntry(
  index: ShopifyInventoryIndex,
  inventoryItemId: number | string,
  productId: string
): ShopifyInventoryIndex {
  const key = String(inventoryItemId);
  if (index[key] === productId) return index;
  return { ...index, [key]: productId };
}
