/**
 * eBay listing link origin — imported vs INW-created.
 * Imported listings use passthrough sync (live eBay aspects are source of truth).
 */

export type EbayLinkOrigin = "import" | "inw_create";

const IMPORTED_EBAY_SKU = /^inw\d+$/i;

export type EbayLinkOriginInput = {
  provider: string;
  externalListingId: string;
  storeItemId?: string;
  linkOrigin?: string | null;
};

/** True when the listing was imported from eBay (migrated SKU inw{legacyId}). */
export function isImportedEbayLink(link: EbayLinkOriginInput): boolean {
  if (link.provider !== "ebay") return false;
  if (link.linkOrigin === "import") return true;
  if (link.linkOrigin === "inw_create") return false;
  return IMPORTED_EBAY_SKU.test(link.externalListingId.trim());
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
