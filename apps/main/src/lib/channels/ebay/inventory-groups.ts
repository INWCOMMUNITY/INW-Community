import { ebayJson } from "./client";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";

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

export function buildVariantInventorySkus(item: SyncStoreItem): string[] {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[];
  const primary = axes[0]!;
  const baseSku = getEffectiveSku(item);
  return primary.options.map((option) => `${baseSku}-${option.value}`.slice(0, 50));
}
