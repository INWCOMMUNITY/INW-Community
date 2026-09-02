import { ebayGet, ebayJson } from "./client";
import { selectPassthroughInventoryImageUrls } from "./media";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { generateEbayVariationMigrationSku, isValidEbayInventorySku } from "./migrate-prep";
import {
  aspectsToEbayProductAspects,
  parseStoredAspects,
  type ListingAspect,
} from "@/lib/listing-limits";

export function shouldUseInventoryItemGroup(item: SyncStoreItem): boolean {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null;
  return Boolean(axes && axes.length > 0 && axes[0]?.options.length > 1);
}

export function buildInventoryItemGroupKey(item: SyncStoreItem): string {
  return `inw-group-${getEffectiveSku(item)}`.slice(0, 50);
}

/** Shared Type/Brand (and other non-variation specifics) on the group — required before publish. */
export function commonAspectsForInventoryItemGroup(
  rows: ListingAspect[],
  variationName: string
): Record<string, string[]> {
  const aspects = aspectsToEbayProductAspects(rows);
  const vary = variationName.trim().toLowerCase();
  for (const key of Object.keys(aspects)) {
    if (key.trim().toLowerCase() === vary) delete aspects[key];
  }
  const brandNameKey = Object.keys(aspects).find((key) => key.trim().toLowerCase() === "brand name");
  if (
    brandNameKey &&
    aspects[brandNameKey]?.some((value) => value.trim()) &&
    !aspects.Brand?.some((value) => value.trim())
  ) {
    aspects.Brand = aspects[brandNameKey];
  }
  return aspects;
}

export function buildInventoryItemGroupBody(
  item: SyncStoreItem,
  variantSkus: string[],
  aspectRows?: ListingAspect[]
): Record<string, unknown> {
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[];
  const primary = axes[0]!;
  const values = primary.options.map((option) => option.value);
  const aspects = commonAspectsForInventoryItemGroup(
    aspectRows ?? parseStoredAspects(item.aspects),
    primary.name
  );
  const body: Record<string, unknown> = {
    inventoryItemGroupKey: buildInventoryItemGroupKey(item),
    variantSKUs: variantSkus,
    title: item.title,
    description: item.description ?? item.title,
    variesBy: {
      specifications: [{ name: primary.name, values }],
      aspectsImageVariesBy: [primary.name],
    },
    imageUrls: selectPassthroughInventoryImageUrls([], item.photos),
  };
  if (Object.keys(aspects).length > 0) body.aspects = aspects;
  return body;
}

export function readInventoryItemGroupImageUrls(
  body: Record<string, unknown> | null | undefined
): string[] {
  if (!body || !Array.isArray(body.imageUrls)) return [];
  return body.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

/** Keep live EPS on a published group so a later PUT does not mix INW blob URLs (#25014). */
export function pinInventoryItemGroupImageUrls(
  body: Record<string, unknown>,
  liveUrls: string[],
  inwUrls: string[]
): Record<string, unknown> {
  const pinned = selectPassthroughInventoryImageUrls(liveUrls, inwUrls);
  if (pinned.length === 0) return body;
  return { ...body, imageUrls: pinned };
}

/** Resyncs keep live group photos unless the seller changed photos on INW. */
export function applyInventoryItemGroupPhotoPolicy(
  body: Record<string, unknown>,
  liveUrls: string[],
  inwUrls: string[],
  pushInwPhotos: boolean
): Record<string, unknown> {
  if (pushInwPhotos) return pinInventoryItemGroupImageUrls(body, liveUrls, inwUrls);
  const live = liveUrls.filter((url) => typeof url === "string" && url.trim().length > 0);
  if (live.length > 0) return { ...body, imageUrls: live };
  const next = { ...body };
  delete next.imageUrls;
  return next;
}

export async function fetchLiveInventoryItemGroup(
  accessToken: string,
  key: string
): Promise<Record<string, unknown> | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;
  try {
    return await ebayGet<Record<string, unknown>>(
      accessToken,
      `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(trimmed)}`
    );
  } catch {
    return null;
  }
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
  /**
   * Imported eBay listings keep migrate-style `inw{listingId}vN` SKUs.
   * INW-created listings must not switch SKUs after the numeric Item ID exists —
   * that creates new inventory rows (qty 1) and leaves the live group on the old SKUs.
   */
  imported?: boolean;
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
    if (!sku && options.imported && legacyId) {
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

/** Stamp generated eBay Inventory SKUs onto INW option rows so later syncs reuse them. */
export function mergeGeneratedSkusIntoVariants(
  variants: unknown,
  rows: EbayVariantInventoryRow[]
): InwVariantAxis[] | null {
  const axes = normalizeVariantsFromProvider("ebay", variants) as InwVariantAxis[] | null;
  if (!axes?.length) return null;
  const skuByValue = new Map(rows.map((row) => [row.value.trim().toLowerCase(), row.sku]));
  return axes.map((axis, index) => {
    if (index !== 0) return axis;
    return {
      ...axis,
      options: axis.options.map((option) => {
        const sku = skuByValue.get(option.value.trim().toLowerCase()) ?? option.sku;
        return sku ? { ...option, sku } : option;
      }),
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
