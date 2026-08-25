import { allTags, tag } from "./photos";

/** Inventory API SKU: alphanumeric only, 1–50 chars (#25707). */
export function isValidEbayInventorySku(sku: string): boolean {
  return /^[a-zA-Z0-9]{1,50}$/.test(sku.trim());
}

/**
 * Backoff after a successful Revise before GetItem must show the SKU.
 * Immediate check plus ~8s of waits so eBay lag does not skip a stamped listing.
 */
export const EBAY_SKU_VERIFY_DELAYS_MS = [0, 800, 1600, 2400, 3200] as const;

/**
 * True when bulk_migrate_listing is unnecessary: the row is already Inventory-native
 * (non-numeric listing id) or preview already has our migrated `inw…` SKU.
 */
export function canSkipEbayBulkMigrate(listingId: string, knownSku?: string | null): boolean {
  const id = listingId.trim();
  if (!id) return false;
  if (!/^\d+$/.test(id)) return true;
  const sku = knownSku?.trim();
  if (!sku || !isValidEbayInventorySku(sku)) return false;
  return /^inw/i.test(sku);
}

/** Inventory API SKU for a migrated listing. Must be alphanumeric and <= 50 chars. */
export function generateEbayMigrationSku(listingId: string): string {
  return `inw${listingId}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
}

export const NOT_FIXED_PRICE_MIGRATE_ERROR =
  "not_fixed_price — eBay can only sync fixed-price (Buy It Now) listings. Auctions and classified ads can't be synced.";

export const ENDED_LISTING_MIGRATE_ERROR =
  "This eBay listing has ended and cannot be imported.";

export const VARIATION_SKU_MIGRATE_ERROR =
  "This multi-variation listing needs a unique Custom Label on each variation before it can sync.";

export type EbayVariationSkuRow = {
  sku: string | null;
  specificsXml: string;
};

export type EbayMigrateClass =
  | { kind: "not_fixed_price"; listingType: string }
  | { kind: "ended"; listingStatus: string }
  | { kind: "ready"; itemSku: string | null; listingType: string; variations: EbayVariationSkuRow[] };

export function generateEbayVariationMigrationSku(listingId: string, index: number): string {
  return `inw${listingId}v${index + 1}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
}

/** Classify a GetItem <Item> XML blob for Inventory migrate. */
export function classifyEbayItemForMigration(itemXml: string): EbayMigrateClass {
  const listingType = (tag(itemXml, "ListingType") ?? "").trim();
  const listingStatus = (tag(itemXml, "ListingStatus") ?? "").trim();
  if (/ended|completed/i.test(listingStatus)) {
    return { kind: "ended", listingStatus };
  }
  if (/adtype|classified|leadgeneration/i.test(listingType)) {
    return { kind: "not_fixed_price", listingType: listingType || "Classified" };
  }
  if (/chinese/i.test(listingType) && !/fixedprice/i.test(listingType)) {
    return { kind: "not_fixed_price", listingType: listingType || "Chinese" };
  }
  if (/auction/i.test(listingType) && !/fixedprice|storesfixedprice|personaloffer/i.test(listingType)) {
    return { kind: "not_fixed_price", listingType };
  }

  const itemSku = tag(itemXml, "SKU")?.trim() || null;
  const variationsBlock = tag(itemXml, "Variations");
  const variations: EbayVariationSkuRow[] = [];
  if (variationsBlock) {
    for (const v of allTags(variationsBlock, "Variation")) {
      variations.push({
        sku: tag(v, "SKU")?.trim() || null,
        specificsXml: tag(v, "VariationSpecifics") ?? "",
      });
    }
  }
  return {
    kind: "ready",
    itemSku,
    listingType: listingType || "FixedPriceItem",
    variations,
  };
}

export function listingHasValidMigrateSku(cls: EbayMigrateClass): boolean {
  if (cls.kind !== "ready") return false;
  const itemOk = Boolean(cls.itemSku && isValidEbayInventorySku(cls.itemSku));
  if (cls.variations.length === 0) return itemOk;
  const varsOk = cls.variations.every((v) => Boolean(v.sku && isValidEbayInventorySku(v.sku)));
  return itemOk && varsOk;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildReviseItemSkuXml(listingId: string, sku: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${escapeXml(listingId)}</ItemID>
    <SKU>${escapeXml(sku)}</SKU>
  </Item>
</ReviseFixedPriceItemRequest>`;
}

export function buildReviseVariationSkusXml(
  listingId: string,
  parentSku: string,
  rows: EbayVariationSkuRow[],
  variationSkus: string[]
): string {
  const variationXml = rows
    .map((row, i) => {
      const sku = variationSkus[i] ?? generateEbayVariationMigrationSku(listingId, i);
      const specifics = row.specificsXml.trim()
        ? `<VariationSpecifics>${row.specificsXml}</VariationSpecifics>`
        : "<VariationSpecifics></VariationSpecifics>";
      return `<Variation><SKU>${escapeXml(sku)}</SKU>${specifics}</Variation>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${escapeXml(listingId)}</ItemID>
    <SKU>${escapeXml(parentSku)}</SKU>
    <Variations>${variationXml}</Variations>
  </Item>
</ReviseFixedPriceItemRequest>`;
}

export function plannedVariationSkus(listingId: string, rows: EbayVariationSkuRow[]): string[] {
  return rows.map((row, i) =>
    row.sku && isValidEbayInventorySku(row.sku)
      ? row.sku
      : generateEbayVariationMigrationSku(listingId, i)
  );
}

export function plannedParentSku(listingId: string, itemSku: string | null): string {
  if (itemSku && isValidEbayInventorySku(itemSku)) return itemSku;
  return generateEbayMigrationSku(listingId);
}
