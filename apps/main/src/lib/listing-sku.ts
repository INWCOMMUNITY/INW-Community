/** Shared INW / Shopify / Etsy cap. Etsy rejects anything longer. */
export const LISTING_SKU_MAX = 32;

/** Etsy listing inventory SKU cap (`/sku cannot be more than 32 characters`). */
export const ETSY_SKU_MAX = 32;

/**
 * Exact-same SKU contract for Shopify and Etsy: letters, numbers, and hyphens, 32 characters.
 */
export const CANONICAL_SKU_MAX = ETSY_SKU_MAX;
export const CANONICAL_SKU_RE = /^(?=.*[a-zA-Z0-9])[a-zA-Z0-9-]{1,32}$/;

/** eBay migrated inventory keys like inw403004607151 — not a seller custom SKU. */
const EBAY_MIGRATION_SKU = /^inw\d+$/i;

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Map an INW/eBay SKU onto Etsy's 32-character inventory cap without changing
 * what INW stores. Long codes become a stable alphanumeric prefix + hash.
 */
export function clampEtsySku(sku: string, salt = ""): string {
  const trimmed = sku.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= ETSY_SKU_MAX) return trimmed;
  const hash = fnv1a32(`${trimmed}\0${salt}`).slice(0, 8);
  const prefixLen = Math.max(1, ETSY_SKU_MAX - hash.length);
  const compact = trimmed.replace(/[^a-zA-Z0-9]/g, "");
  const prefix = (compact || trimmed).slice(0, prefixLen);
  return `${prefix}${hash}`.slice(0, ETSY_SKU_MAX);
}

export function normalizeListingSku(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim().slice(0, LISTING_SKU_MAX);
  return trimmed || null;
}

export function isEbayMigrationSku(sku: string | null | undefined): boolean {
  return Boolean(sku && EBAY_MIGRATION_SKU.test(sku.trim()));
}

/** True when the SKU can be published unchanged to Shopify and Etsy. */
export function isCanonicalChannelSku(sku: string | null | undefined): boolean {
  const trimmed = sku?.trim() ?? "";
  return CANONICAL_SKU_RE.test(trimmed);
}

/**
 * Keep letters, numbers, and hyphens, and cap at 32 so the same string is legal on every channel.
 * Empty after stripping is null (not a usable identity).
 */
export function toCanonicalChannelSku(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, CANONICAL_SKU_MAX);
  if (!CANONICAL_SKU_RE.test(compact)) return null;
  return compact;
}

/**
 * Shopify cartesian fallbacks look like `{itemId}-Purple`. Those must not become
 * the parent StoreItem SKU.
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
 * Fill an empty INW SKU from a channel listing. Adopts live eBay Inventory pins
 * (including `inw{legacyId}`) and seller SKUs that use letters, numbers, and hyphens.
 * Rejects StoreItem.id leftovers.
 */
export function skuToAdoptFromRemote(args: {
  localSku: string | null | undefined;
  remoteSku: string | null | undefined;
  itemId: string;
}): string | null {
  if (normalizeListingSku(args.localSku)) return null;
  const sku = normalizeListingSku(args.remoteSku);
  if (!sku || sku === args.itemId || isGeneratedVariantOfItemId(sku, args.itemId)) return null;
  if (!isCanonicalChannelSku(sku)) return null;
  return sku;
}

/**
 * Generate a SKU from a seed (like an ID).
 * Creates a letters-and-numbers string within the 32-character channel cap.
 */
export function generateListingSku(seed: string): string {
  // Create a hash-based SKU from the seed
  const hash = fnv1a32(seed + Date.now().toString(36));
  const prefix = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16).toUpperCase() || "INW";
  return `${prefix}${hash}`.slice(0, CANONICAL_SKU_MAX);
}
