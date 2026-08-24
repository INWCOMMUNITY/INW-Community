/**
 * eBay listing link origin — imported vs INW-created.
 * Imported listings use passthrough sync (live eBay aspects are source of truth).
 */

export type EbayLinkOrigin = "import" | "inw_create";

const IMPORTED_EBAY_SKU = /^inw\d+$/i;
/** Numeric eBay legacy Item ID (older links stored this instead of inw SKU). */
const LEGACY_EBAY_ITEM_ID = /^\d{9,15}$/;

export type EbayLinkOriginInput = {
  provider: string;
  externalListingId: string;
  storeItemId?: string;
  linkOrigin?: string | null;
};

/** Inventory API SKU — normalize numeric legacy Item IDs to inw{legacyId}. */
export function resolveEbayInventorySku(externalListingId: string): string {
  const trimmed = externalListingId.trim();
  if (!trimmed) return trimmed;
  if (IMPORTED_EBAY_SKU.test(trimmed)) return trimmed;
  if (LEGACY_EBAY_ITEM_ID.test(trimmed)) return `inw${trimmed}`;
  return trimmed;
}

/**
 * SKU for Inventory API writes. INW-created listings keep StoreItem id as the SKU
 * even when ChannelListingLink.externalListingId stores the live eBay listing id.
 */
export function resolveEbayPushSku(args: {
  itemId: string;
  itemSku?: string | null;
  externalListingId: string;
  linkOrigin?: string | null;
}): string {
  if (args.linkOrigin === "inw_create") {
    const sku = args.itemSku?.trim();
    // Migrated inw{listingId} SKUs must not replace the original StoreItem id SKU —
    // that publishes a second live listing on the next cron push.
    if (sku && !IMPORTED_EBAY_SKU.test(sku)) return sku;
    return args.itemId;
  }
  if (args.linkOrigin === "import") {
    return resolveEbayInventorySku(args.externalListingId);
  }
  if (!args.linkOrigin && args.externalListingId === args.itemId) {
    return args.itemSku?.trim() || args.itemId;
  }
  return resolveEbayInventorySku(args.externalListingId);
}

/** True when the listing was imported from eBay (migrated SKU inw{legacyId}). */
export function isImportedEbayLink(link: EbayLinkOriginInput): boolean {
  if (link.provider !== "ebay") return false;
  const id = link.externalListingId.trim();
  // Migrated inw SKU is definitive — wins over a corrupted linkOrigin flag.
  if (IMPORTED_EBAY_SKU.test(id)) return true;
  if (link.linkOrigin === "import") return true;
  if (link.linkOrigin === "inw_create") return false;
  // INW-created listings used StoreItem.id as externalListingId; newer links store the live listing id
  // with linkOrigin = inw_create and keep StoreItem.id as the Inventory SKU.
  if (link.storeItemId && id === link.storeItemId) return false;
  // Older imports may store numeric legacy Item ID instead of inw SKU.
  if (LEGACY_EBAY_ITEM_ID.test(id)) return true;
  return false;
}

/** True when the listing was created in INW and published to eBay. */
export function isInwCreatedEbayLink(link: EbayLinkOriginInput): boolean {
  if (link.provider !== "ebay") return false;
  if (link.linkOrigin === "inw_create") return true;
  if (link.linkOrigin === "import") return false;
  if (link.storeItemId && link.externalListingId === link.storeItemId) return true;
  return !IMPORTED_EBAY_SKU.test(link.externalListingId.trim());
}

/** Infer origin for backfill when linkOrigin is null. */
export function inferEbayLinkOrigin(link: EbayLinkOriginInput): EbayLinkOrigin {
  return isImportedEbayLink(link) ? "import" : "inw_create";
}

/** Extract raw product.aspects object from GET inventory_item response. */
export function extractEbayInventoryAspects(
  inventoryItem: Record<string, unknown> | null | undefined
): Record<string, string[]> | null {
  const product = inventoryItem?.product;
  if (!product || typeof product !== "object") return null;
  const aspects = (product as Record<string, unknown>).aspects;
  if (!aspects || typeof aspects !== "object" || Array.isArray(aspects)) return null;
  const out: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(aspects as Record<string, unknown>)) {
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    if (Array.isArray(values)) {
      const arr = values.map((v) => String(v).trim()).filter(Boolean);
      if (arr.length > 0) out[trimmedName] = arr;
    } else if (values != null && String(values).trim()) {
      out[trimmedName] = [String(values).trim()];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
