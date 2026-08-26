import { ebayJson } from "./client";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { generateEbayVariationMigrationSku, isValidEbayInventorySku } from "./migrate-prep";

export function shouldUseInventoryItemGroup(item: SyncStoreItem): boolean {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null;
  return Boolean(axes && axes.length > 0 && axes[0]?.options.length > 1);
}

export function buildInventoryItemGroupKey(item: SyncStoreItem): string {
  return `inw-group-${getEffectiveSku(item)}`.slice(0, 50);
}

export function buildInventoryItemGroupBody(
  item: SyncStoreItem,
  variantSkus: string[]
): Record<string, unknown> {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[];
  const primary = axes[0]!;
  const values = primary.options.map((option) => option.value);
  return {
    inventoryItemGroupKey: buildInventoryItemGroupKey(item),
    variantSKUs: variantSkus,
    title: item.title,
    description: item.description ?? item.title,
    variesBy: {
      specifications: [{ name: primary.name, values }],
      aspectsImageVariesBy: [primary.name],
    },
    imageUrls: item.photos.slice(0, 12),
  };
}

export async function createOrReplaceInventoryItemGroup(
  accessToken: string,
  body: Record<string, unknown>
): Promise<void> {
  const key = String(body.inventoryItemGroupKey ?? "").trim();
  if (!key) throw new Error("inventoryItemGroupKey is required");
  await ebayJson(
    accessToken,
    `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(key)}`,
    "PUT",
    body
  );
}

export async function publishOfferByInventoryItemGroup(
  accessToken: string,
  inventoryItemGroupKey: string
): Promise<{ listingId?: string }> {
  return ebayJson<{ listingId?: string }>(
    accessToken,
    `/sell/inventory/v1/offer/publish_by_inventory_item_group`,
    "POST",
    { inventoryItemGroupKey, marketplaceId: "EBAY_US" }
  );
}

function alphanumericSku(raw: string, max = 50): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, max);
}

export type EbayVariantInventoryRow = {
  sku: string;
  value: string;
  quantity: number;
  aspectName: string;
};

export type BuildVariantInventoryRowsOptions = {
  /** Inventory SKU of the parent listing (imported `inw{legacyId}` or INW-created SKU). */
  parentSku?: string | null;
  /** eBay legacy Item ID — used so generated SKUs match migrate (`inw{listingId}vN`). */
  legacyListingId?: string | null;
};

function optionSku(option: InwVariantAxis["options"][number]): string | null {
  const sku = option.sku?.trim();
  if (!sku || !isValidEbayInventorySku(sku)) return null;
  return sku;
}

/**
 * Unique alphanumeric Inventory SKUs for each variation.
 * Prefers a seller/imported option SKU, then INW-generated keys — sellers do not
 * need to type Custom Labels in Seller Hub before a push.
 */
export function buildVariantInventoryRows(
  item: SyncStoreItem,
  options: BuildVariantInventoryRowsOptions = {}
): EbayVariantInventoryRow[] {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[];
  const primary = axes[0]!;
  const baseSku = alphanumericSku(options.parentSku?.trim() || getEffectiveSku(item), 36);
  const legacyId = options.legacyListingId?.trim() || "";
  const used = new Set<string>();
  return primary.options.map((option, i) => {
    const existing = optionSku(option);
    let sku = existing && !used.has(existing) ? existing : "";
    if (!sku && legacyId) {
      sku = generateEbayVariationMigrationSku(legacyId, i);
    }
    if (!sku || !isValidEbayInventorySku(sku) || used.has(sku)) {
      const valuePart = alphanumericSku(option.value, 12);
      sku = `${baseSku}${valuePart}`.slice(0, 50);
    }
    if (!sku || !isValidEbayInventorySku(sku) || used.has(sku)) {
      sku = `${baseSku}v${i + 1}`.slice(0, 50);
    }
    if (!isValidEbayInventorySku(sku) || used.has(sku)) {
      sku = alphanumericSku(`inw${item.id}v${i + 1}`, 50);
    }
    used.add(sku);
    return {
      sku,
      value: option.value,
      quantity: Math.max(0, option.quantity),
      aspectName: primary.name,
    };
  });
}

export function buildVariantInventorySkus(
  item: SyncStoreItem,
  options: BuildVariantInventoryRowsOptions = {}
): string[] {
  return buildVariantInventoryRows(item, options).map((row) => row.sku);
}

/** Narrow a parent SyncStoreItem to one variation so Inventory aspects are that value only. */
export function buildVariantSyncItem(
  item: SyncStoreItem,
  row: EbayVariantInventoryRow
): SyncStoreItem {
  return {
    ...item,
    sku: row.sku,
    quantity: row.quantity,
    variants: [
      {
        name: row.aspectName,
        options: [{ value: row.value, quantity: row.quantity, sku: row.sku }],
      },
    ],
  };
}

/** Pin the variation aspect on an inventory PUT so eBay does not see a parent SKU. */
export function withVariationAspect(
  body: Record<string, unknown>,
  row: EbayVariantInventoryRow
): Record<string, unknown> {
  const product =
    body.product && typeof body.product === "object"
      ? { ...(body.product as Record<string, unknown>) }
      : {};
  const aspects =
    product.aspects && typeof product.aspects === "object" && !Array.isArray(product.aspects)
      ? { ...(product.aspects as Record<string, unknown>) }
      : {};
  aspects[row.aspectName] = [row.value];
  product.aspects = aspects;
  return { ...body, product };
}
