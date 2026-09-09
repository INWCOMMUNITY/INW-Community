import { ebayGet, ebayJson } from "./client";
import {
  liveEbayPhotoUrlsToPin,
  selectPassthroughInventoryImageUrls,
  uniformHostFamilyImageUrls,
} from "./media";
import { normalizeVariantsFromProvider, variantsToMatrix, type InwVariantAxis } from "../variant-sync";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { generateEbayVariationMigrationSku, isValidEbayInventorySku } from "./migrate-prep";
import {
  aspectsToEbayProductAspects,
  parseStoredAspects,
  type ListingAspect,
} from "@/lib/listing-limits";
import {
  channelQuantityForTracked,
  pickImageVaryingAxisName,
  stampSkuCodes,
  isMadeToOrderTracking,
  normalizeVariantMatrix,
} from "@/lib/listing-variant-matrix";

export function shouldUseInventoryItemGroup(item: SyncStoreItem): boolean {
  const matrix = variantsToMatrix(item.variants);
  if (matrix && matrix.skus.length > 1) return true;
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null;
  return Boolean(axes && axes.length > 0 && axes[0]?.options.length > 1);
}

export function buildInventoryItemGroupKey(item: SyncStoreItem): string {
  return `inw-group-${getEffectiveSku(item)}`.slice(0, 50);
}

/** Shared Type/Brand (and other non-variation specifics) on the group — required before publish. */
export function commonAspectsForInventoryItemGroup(
  rows: ListingAspect[],
  variationNames: string | string[]
): Record<string, string[]> {
  const aspects = aspectsToEbayProductAspects(rows);
  const varySet = new Set(
    (Array.isArray(variationNames) ? variationNames : [variationNames]).map((n) => n.trim().toLowerCase())
  );
  for (const key of Object.keys(aspects)) {
    if (varySet.has(key.trim().toLowerCase())) delete aspects[key];
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
  const matrix = variantsToMatrix(item.variants);
  const axes = matrix?.axes?.length
    ? matrix.axes.map((a) => ({ name: a.name, values: a.values }))
    : (normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[]).map((a) => ({
        name: a.name,
        values: a.options.map((o) => o.value),
      }));
  const primary = axes[0]!;
  const imageAxis = matrix ? pickImageVaryingAxisName(matrix) : primary.name;
  const aspects = commonAspectsForInventoryItemGroup(
    aspectRows ?? parseStoredAspects(item.aspects),
    axes.map((a) => a.name)
  );
  const imageAxisPhotos =
    matrix?.axes
      .find((a) => a.name === imageAxis)
      ?.photosByValue
      ? Object.values(
          matrix.axes.find((a) => a.name === imageAxis)?.photosByValue ?? {}
        ).flat()
      : [];
  const body: Record<string, unknown> = {
    inventoryItemGroupKey: buildInventoryItemGroupKey(item),
    variantSKUs: variantSkus,
    title: item.title,
    description: item.description ?? item.title,
    variesBy: {
      specifications: axes.map((a) => ({ name: a.name, values: a.values })),
      aspectsImageVariesBy: [imageAxis],
    },
    imageUrls: selectPassthroughInventoryImageUrls([], [...imageAxisPhotos, ...item.photos]),
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

/** Resyncs keep live EPS group photos. Never send INW blobs onto a published group. */
export function applyInventoryItemGroupPhotoPolicy(
  body: Record<string, unknown>,
  liveUrls: string[],
  inwUrls: string[],
  pushInwPhotos: boolean
): Record<string, unknown> {
  if (pushInwPhotos) return pinInventoryItemGroupImageUrls(body, liveUrls, inwUrls);
  const live = liveEbayPhotoUrlsToPin(liveUrls);
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
  const rawUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  const imageUrls = uniformHostFamilyImageUrls(rawUrls);
  const payload: Record<string, unknown> = { ...body };
  if (imageUrls.length > 0) payload.imageUrls = imageUrls;
  else delete payload.imageUrls;
  await ebayJson(
    accessToken,
    `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(key)}`,
    "PUT",
    payload
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
  options: Record<string, string>;
  priceCents?: number;
  photos?: string[];
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
  const matrix = variantsToMatrix(item.variants);
  const axes = normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[];
  if (!axes?.length) return [];
  if ((!matrix || matrix.skus.length === 0) && axes.length >= 2) {
    throw new Error(
      "INW combinations are missing SKU rows. Save the listing with Size × Color quantities before listing on eBay."
    );
  }
  const primary = axes[0]!;
  const baseSku = alphanumericSku(options.parentSku?.trim() || getEffectiveSku(item), 36);
  const legacyId = options.legacyListingId?.trim() || "";
  const used = new Set<string>();
  const source =
    matrix && matrix.skus.length > 0
      ? matrix.skus.map((s) => ({
          value: s.options[primary.name] ?? Object.values(s.options)[0] ?? "",
          quantity: s.quantity,
          sku: s.sku,
          options: s.options,
          priceCents: s.priceCents,
          photos: s.photos,
        }))
      : primary.options.map((option) => ({
          value: option.value,
          quantity: option.quantity,
          sku: option.sku,
          options: { [primary.name]: option.value },
          priceCents: undefined as number | undefined,
          photos: undefined as string[] | undefined,
        }));

  return source.map((option, i) => {
    const existing = option.sku?.trim() && isValidEbayInventorySku(option.sku) ? option.sku.trim() : null;
    let sku = existing && !used.has(existing) ? existing : "";
    if (!sku && options.imported && legacyId) {
      sku = generateEbayVariationMigrationSku(legacyId, i);
    }
    if (!sku || !isValidEbayInventorySku(sku) || used.has(sku)) {
      const valuePart = alphanumericSku(Object.values(option.options).join(""), 12);
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
      quantity: channelQuantityForTracked(option.quantity, item.inventoryTracking),
      aspectName: primary.name,
      options: option.options,
      ...(option.priceCents != null ? { priceCents: option.priceCents } : {}),
      ...(option.photos ? { photos: option.photos } : {}),
    };
  });
}

/** Stamp generated eBay Inventory SKUs onto INW option/SKU rows so later syncs reuse them. */
export function mergeGeneratedSkusIntoVariants(
  variants: unknown,
  rows: EbayVariantInventoryRow[]
): unknown {
  const matrix = normalizeVariantMatrix(variants);
  if (matrix && matrix.skus.length > 0) {
    return stampSkuCodes(
      matrix,
      rows.map((row) => ({ options: row.options, sku: row.sku }))
    );
  }
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
  const qty = channelQuantityForTracked(row.quantity, item.inventoryTracking);
  const optionEntries = Object.entries(row.options ?? { [row.aspectName]: row.value });
  return {
    ...item,
    sku: row.sku,
    quantity: qty,
    priceCents: row.priceCents && row.priceCents > 0 ? row.priceCents : item.priceCents,
    photos: row.photos && row.photos.length > 0 ? row.photos : item.photos,
    variants: optionEntries.map(([name, value]) => ({
      name,
      options: [{ value, quantity: qty, sku: row.sku }],
    })),
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
  const options = row.options && Object.keys(row.options).length > 0
    ? row.options
    : { [row.aspectName]: row.value };
  for (const [name, value] of Object.entries(options)) {
    aspects[name] = [value];
  }
  product.aspects = aspects;
  return { ...body, product };
}
