import { ebayJson } from "./client";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { isValidEbayInventorySku } from "./migrate-prep";

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
  return {
    inventoryItemGroupKey: buildInventoryItemGroupKey(item),
    variantSKUs: variantSkus,
    title: item.title,
    description: item.description,
    aspects: {
      [primary.name]: primary.options.map((option) => option.value),
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
};

/** eBay Inventory SKUs must be alphanumeric (#25707). Hyphens in `base-size` always fail. */
export function buildVariantInventoryRows(item: SyncStoreItem): EbayVariantInventoryRow[] {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[];
  const primary = axes[0]!;
  const baseSku = alphanumericSku(getEffectiveSku(item), 36);
  const used = new Set<string>();
  return primary.options.map((option, i) => {
    const valuePart = alphanumericSku(option.value, 12);
    let sku = `${baseSku}${valuePart}`.slice(0, 50);
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
    };
  });
}

export function buildVariantInventorySkus(item: SyncStoreItem): string[] {
  return buildVariantInventoryRows(item).map((row) => row.sku);
}
