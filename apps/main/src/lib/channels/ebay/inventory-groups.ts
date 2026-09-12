import { ebayGet, ebayJson } from "./client";
import {
  liveEbayPhotoUrlsToPin,
  selectPassthroughInventoryImageUrls,
  uniformHostFamilyImageUrls,
} from "./media";
import { normalizeVariantsFromProvider, variantsToMatrix, type InwVariantAxis } from "../variant-sync";
import { variantOptionsMatch } from "../variant-match";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { generateEbayVariationMigrationSku, isValidEbayInventorySku, toEbayInventorySku } from "./migrate-prep";
import { isGeneratedVariantOfItemId } from "@/lib/listing-sku";
import { extractEbayInventoryAspects } from "./listing-origin";
import { parseEbayInventorySkuInAnotherGroup } from "./errors";
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
  const raw = getEffectiveSku(item);
  const stable = isGeneratedVariantOfItemId(raw, item.id) ? item.id : raw;
  return `inw-group-${stable}`.slice(0, 50);
}

function variantOptionValues(item: SyncStoreItem): string[] {
  const values = new Set<string>();
  const matrix = variantsToMatrix(item.variants);
  if (matrix) {
    for (const axis of matrix.axes) {
      for (const value of axis.values) {
        if (value.trim()) values.add(value.trim());
      }
    }
    for (const row of matrix.skus) {
      for (const value of Object.values(row.options)) {
        if (value.trim()) values.add(value.trim());
      }
    }
  }
  return [...values];
}

/** Group keys INW may have used as StoreItem.sku drifted onto a variant Custom Label. */
export function inventoryItemGroupKeysToTry(
  item: SyncStoreItem,
  parentSku?: string | null
): string[] {
  const keys: string[] = [];
  const push = (raw: string | null | undefined) => {
    const value = raw?.trim();
    if (!value) return;
    keys.push(`inw-group-${value}`.slice(0, 50));
    const stripped = toEbayInventorySku(value);
    if (stripped && stripped !== value) keys.push(`inw-group-${stripped}`.slice(0, 50));
  };
  keys.push(buildInventoryItemGroupKey(item));
  push(item.id);
  push(parentSku);
  push(item.sku);
  // Leftover Color-only groups were keyed `inw-group-{itemId}-Purple` even after
  // StoreItem.sku was cleaned. Keep looking those up so Size × Color SKUs stay put.
  for (const value of variantOptionValues(item)) {
    push(`${item.id}-${value}`);
    push(`${item.id}${value}`);
  }
  return [...new Set(keys)];
}

export function pickLiveEbayInventoryItemGroup(
  found: { key: string; body: Record<string, unknown> }[],
  fallbackKey: string
): { key: string; body: Record<string, unknown> | null } {
  const withSkus = found.find((row) => readInventoryItemGroupVariantSkus(row.body).length > 0);
  if (withSkus) return withSkus;
  if (found[0]) return found[0];
  return { key: fallbackKey, body: null };
}

export function readInventoryItemGroupVariantSkus(
  body: Record<string, unknown> | null | undefined
): string[] {
  if (!body || !Array.isArray(body.variantSKUs)) return [];
  return body.variantSKUs
    .filter((sku): sku is string => typeof sku === "string" && sku.trim().length > 0)
    .map((sku) => sku.trim());
}

export async function resolveLiveEbayInventoryItemGroup(
  accessToken: string,
  item: SyncStoreItem,
  parentSku?: string | null
): Promise<{ key: string; body: Record<string, unknown> | null }> {
  const keys = inventoryItemGroupKeysToTry(item, parentSku);
  const found: { key: string; body: Record<string, unknown> }[] = [];
  for (const key of keys) {
    const body = await fetchLiveInventoryItemGroup(accessToken, key);
    if (body) {
      const liveKey = String(body.inventoryItemGroupKey ?? key).trim() || key;
      found.push({ key: liveKey, body });
    }
  }
  return pickLiveEbayInventoryItemGroup(found, keys[0] ?? buildInventoryItemGroupKey(item));
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

/** Item photos plus per-option photos that will become the variation-group gallery. */
export function inventoryItemGroupInwPhotoUrls(item: SyncStoreItem): string[] {
  const matrix = variantsToMatrix(item.variants);
  const axes = matrix?.axes?.length
    ? matrix.axes.map((a) => ({ name: a.name, values: a.values }))
    : (normalizeVariantsFromProvider("ebay", item.variants) as InwVariantAxis[] | null)?.map((a) => ({
        name: a.name,
        values: a.options.map((o) => o.value),
      })) ?? [];
  const primary = axes[0];
  const imageAxis = matrix ? pickImageVaryingAxisName(matrix) : primary?.name;
  const imageAxisPhotos =
    imageAxis && matrix?.axes.find((a) => a.name === imageAxis)?.photosByValue
      ? Object.values(matrix.axes.find((a) => a.name === imageAxis)?.photosByValue ?? {}).flat()
      : [];
  return [...imageAxisPhotos, ...item.photos];
}

export function buildInventoryItemGroupBody(
  item: SyncStoreItem,
  variantSkus: string[],
  aspectRows?: ListingAspect[],
  inventoryItemGroupKey?: string
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
  const body: Record<string, unknown> = {
    inventoryItemGroupKey: inventoryItemGroupKey?.trim() || buildInventoryItemGroupKey(item),
    variantSKUs: variantSkus,
    title: item.title,
    description: item.description ?? item.title,
    variesBy: {
      specifications: axes.map((a) => ({ name: a.name, values: a.values })),
      aspectsImageVariesBy: [imageAxis],
    },
    imageUrls: selectPassthroughInventoryImageUrls([], inventoryItemGroupInwPhotoUrls(item)),
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
): Promise<string> {
  const key = String(body.inventoryItemGroupKey ?? "").trim();
  if (!key) throw new Error("inventoryItemGroupKey is required");
  const rawUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];
  const imageUrls = uniformHostFamilyImageUrls(rawUrls);
  const payload: Record<string, unknown> = { ...body };
  if (imageUrls.length > 0) payload.imageUrls = imageUrls;
  else delete payload.imageUrls;
  try {
    await ebayJson(
      accessToken,
      `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(key)}`,
      "PUT",
      payload
    );
    return key;
  } catch (e) {
    const other = parseEbayInventorySkuInAnotherGroup(e);
    if (!other?.groupId || other.groupId === key) throw e;
    const live = await fetchLiveInventoryItemGroup(accessToken, other.groupId);
    const existingSkus = readInventoryItemGroupVariantSkus(live);
    const ours = Array.isArray(payload.variantSKUs)
      ? payload.variantSKUs.filter((sku): sku is string => typeof sku === "string" && sku.trim().length > 0)
      : [];
    const merged = [...new Set([...existingSkus, ...ours.map((sku) => sku.trim())])];
    const adopted: Record<string, unknown> = {
      ...payload,
      inventoryItemGroupKey: other.groupId,
      variantSKUs: merged,
    };
    await ebayJson(
      accessToken,
      `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(other.groupId)}`,
      "PUT",
      adopted
    );
    return other.groupId;
  }
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

/**
 * Match two eBay variation option selections. Delegates to the shared, axis-name-agnostic
 * matcher so a live Custom Label group whose option names differ from INW still aligns
 * (prevents skipped variant offers -> "some prices sync but not all").
 */
export function variationOptionsMatch(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  return variantOptionsMatch(a, b);
}

function ebayInventorySkuCandidate(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (isValidEbayInventorySku(trimmed)) return trimmed;
  const stripped = toEbayInventorySku(trimmed);
  return stripped && isValidEbayInventorySku(stripped) ? stripped : null;
}

export function readLiveEbayInventorySkusFromVariants(liveVariants: unknown): string[] {
  const matrix = variantsToMatrix(liveVariants);
  if (!matrix?.skus.length) return [];
  const out: string[] = [];
  for (const skuRow of matrix.skus) {
    const sku = ebayInventorySkuCandidate(skuRow.sku);
    if (sku && !out.includes(sku)) out.push(sku);
  }
  return out;
}

function aspectOptionsForRow(
  aspects: Record<string, string[]>,
  rowOptions: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(rowOptions)) {
    const hit = Object.entries(aspects).find(
      ([key]) => key.trim().toLowerCase() === name.trim().toLowerCase()
    );
    const value = hit?.[1]?.find((entry) => String(entry).trim())?.toString().trim();
    if (value) out[name] = value;
  }
  return out;
}

/** Prefer live GetItem Custom Labels over newly generated INW combo SKUs. */
export function applyLiveEbayVariationSkus(
  rows: EbayVariantInventoryRow[],
  liveVariants: unknown
): EbayVariantInventoryRow[] {
  const matrix = variantsToMatrix(liveVariants);
  if (!matrix?.skus.length) return rows;
  const used = new Set<string>();
  return rows.map((row) => {
    const live = matrix.skus.find((skuRow) =>
      variationOptionsMatch(skuRow.options ?? {}, row.options)
    );
    const sku = ebayInventorySkuCandidate(live?.sku);
    if (!sku || used.has(sku)) return row;
    used.add(sku);
    return { ...row, sku };
  });
}

/** If INW generated a SKU that is already on the live group (or a hyphen-stripped form), reuse it. */
export function applyLiveEbayGroupSkus(
  rows: EbayVariantInventoryRow[],
  liveGroupSkus: string[]
): EbayVariantInventoryRow[] {
  if (liveGroupSkus.length === 0) return rows;
  const liveSet = new Set(liveGroupSkus.map((sku) => sku.trim()).filter(Boolean));
  return rows.map((row) => {
    if (liveSet.has(row.sku)) return row;
    const stripped = toEbayInventorySku(row.sku);
    if (stripped && liveSet.has(stripped)) return { ...row, sku: stripped };
    const match = liveGroupSkus.find((sku) => sku.trim().toLowerCase() === row.sku.toLowerCase());
    if (match && isValidEbayInventorySku(match.trim())) return { ...row, sku: match.trim() };
    return row;
  });
}

export function applyLiveInventorySkuByAspects(
  rows: EbayVariantInventoryRow[],
  liveSku: string,
  aspects: Record<string, string[]>
): EbayVariantInventoryRow[] {
  const sku = ebayInventorySkuCandidate(liveSku);
  if (!sku) return rows;
  let assigned = false;
  return rows.map((row) => {
    if (assigned || row.sku === sku) return row;
    const liveOptions = aspectOptionsForRow(aspects, row.options);
    if (!variationOptionsMatch(row.options, liveOptions)) return row;
    assigned = true;
    return { ...row, sku };
  });
}

export async function alignVariantRowsToLiveEbayInventory(
  accessToken: string,
  rows: EbayVariantInventoryRow[],
  liveGroupSkus: string[]
): Promise<EbayVariantInventoryRow[]> {
  let next = applyLiveEbayGroupSkus(rows, liveGroupSkus);
  if (liveGroupSkus.length === 0) return next;
  const matched = new Set(next.filter((row) => liveGroupSkus.includes(row.sku)).map((row) => row.sku));
  const unmatchedLive = liveGroupSkus.filter((sku) => !matched.has(sku));
  for (const liveSku of unmatchedLive) {
    try {
      const inventory = await ebayGet<Record<string, unknown>>(
        accessToken,
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(liveSku)}`
      );
      const aspects = extractEbayInventoryAspects(inventory);
      if (!aspects) continue;
      next = applyLiveInventorySkuByAspects(next, liveSku, aspects);
    } catch {
      /* live SKU may be unpublished */
    }
  }
  return next;
}

export function liveEbayVariantSkusForGroupPut(args: {
  listingAlreadyOnEbay: boolean;
  liveGroupSkus: string[];
  mappedSkus: string[];
}): string[] {
  if (args.listingAlreadyOnEbay && args.liveGroupSkus.length > 0) return args.liveGroupSkus;
  return args.mappedSkus;
}

export function shouldPutEbayVariantInventoryOnLiveListing(args: {
  listingAlreadyOnEbay: boolean;
  sku: string;
  liveKnownSkus: string[];
  pinnedPhotoCount: number;
}): boolean {
  if (args.listingAlreadyOnEbay && args.pinnedPhotoCount === 0) return false;
  if (!args.listingAlreadyOnEbay || args.liveKnownSkus.length === 0) return true;
  return args.liveKnownSkus.includes(args.sku);
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
