import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { normalizeVariantsFromProvider, variantsToMatrix, type InwVariantAxis } from "../variant-sync";
import { listingDescriptionForHtmlChannel } from "../rich-description";
import { shopifyProductTypeForInw } from "../category-suggest";
import { isInwHostedPhotoUrl, isMarketplaceCdnPhotoUrl } from "../photo-urls";
import { isShopifyNoiseCollectionTitle } from "./collections";
import type { ShopifyProductTaxonomyHint } from "./inbound-taxonomy";
import {
  channelQuantityForTracked,
  isMadeToOrderTracking,
  optionsEqual,
  pickImageVaryingAxisName,
  minSkuPriceCents,
  sumMatrixQuantities,
  type VariantMatrix,
  type VariantSkuRow,
} from "@/lib/listing-variant-matrix";

/** cents -> "12.34" (Shopify expects a decimal string). */
export function shopifyPriceFromCents(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

export function shopifyPriceToCents(price?: string | null): number {
  const n = Number(price);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export type ShopifyVariant = {
  id?: number;
  sku?: string | null;
  price?: string;
  inventory_quantity?: number;
  inventory_management?: string | null;
  inventory_item_id?: number;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  requires_shipping?: boolean;
  image_id?: number | null;
  image?: { id?: number; src?: string } | null;
};

export type ShopifyProduct = {
  id?: number;
  title?: string;
  body_html?: string | null;
  product_type?: string | null;
  tags?: string | string[] | null;
  status?: string | null;
  updated_at?: string;
  options?: { name?: string; values?: string[] }[];
  variants?: ShopifyVariant[];
  images?: { id?: number; src?: string }[];
};

const SHOPIFY_NOISE_PRODUCT_TYPES = new Set([
  "physical",
  "digital",
  "service",
  "unspecified",
  "other",
  "n/a",
  "na",
  "none",
  "general",
  "uncategorized",
]);

function shopifyTagsList(tags: ShopifyProduct["tags"]): string[] {
  if (!tags) return [];
  const raw = Array.isArray(tags) ? tags : String(tags).split(",");
  return raw.map((t) => t.trim()).filter(Boolean);
}

function isShopifyNoiseLabel(label: string | null | undefined): boolean {
  const n = label?.trim().toLowerCase() ?? "";
  if (!n) return true;
  return SHOPIFY_NOISE_PRODUCT_TYPES.has(n) || isShopifyNoiseCollectionTitle(n);
}

function splitTaxonomyLeaf(fullName: string): { category: string; subcategory: string | null } {
  const parts = fullName.split(">").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { category: parts.join(" > "), subcategory: parts[parts.length - 1] ?? null };
  }
  return { category: fullName, subcategory: null };
}

/**
 * Pick a category signal: Shopify Admin Category (taxonomy), else product_type,
 * else collection, else first useful tag.
 */
export function pickShopifyCategoryLabel(
  product: Pick<ShopifyProduct, "product_type" | "tags">,
  collectionName?: string | null,
  taxonomyFullName?: string | null
): { category: string | null; subcategory: string | null } {
  const taxonomy = taxonomyFullName?.trim() || null;
  if (taxonomy && !isShopifyNoiseLabel(taxonomy.split(">").pop() ?? taxonomy)) {
    return splitTaxonomyLeaf(taxonomy);
  }
  const productType = product.product_type?.trim() || null;
  if (productType && !isShopifyNoiseLabel(productType)) {
    return { category: productType, subcategory: null };
  }
  const collection = collectionName?.trim() || null;
  if (collection && !isShopifyNoiseLabel(collection)) {
    return { category: collection, subcategory: null };
  }
  const tag = shopifyTagsList(product.tags).find((t) => !isShopifyNoiseLabel(t));
  return { category: tag ?? null, subcategory: null };
}

function shopifyInventoryManagement(item: SyncStoreItem): string | null {
  return isMadeToOrderTracking(item.inventoryTracking) ? null : "shopify";
}

export function shopifyOptionNames(product: Pick<ShopifyProduct, "options"> | null | undefined): string[] {
  return (product?.options ?? [])
    .map((o) => o.name?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 3);
}

export function shopifyVariantOptionMap(
  optionNames: string[],
  variant: Pick<ShopifyVariant, "option1" | "option2" | "option3">
): Record<string, string> {
  const keys = ["option1", "option2", "option3"] as const;
  const out: Record<string, string> = {};
  optionNames.forEach((name, i) => {
    const val = String(variant[keys[i]] ?? "").trim();
    if (name && val) out[name] = val;
  });
  return out;
}

export function findMatrixSkuForShopifyVariant(
  matrix: VariantMatrix,
  optionNames: string[],
  variant: Pick<ShopifyVariant, "option1" | "option2" | "option3">
): VariantSkuRow | null {
  const map = shopifyVariantOptionMap(optionNames, variant);
  if (Object.keys(map).length === 0) return null;
  return matrix.skus.find((s) => optionsEqual(s.options, map)) ?? null;
}

export function quantityForShopifyRemoteVariant(
  item: Pick<SyncStoreItem, "quantity" | "inventoryTracking" | "variants">,
  product: Pick<ShopifyProduct, "options">,
  variant: Pick<ShopifyVariant, "option1" | "option2" | "option3">
): number {
  const matrix = variantsToMatrix(item.variants);
  const names = shopifyOptionNames(product);
  if (matrix && names.length > 0) {
    const sku = findMatrixSkuForShopifyVariant(matrix, names, variant);
    if (sku) return channelQuantityForTracked(sku.quantity, item.inventoryTracking);
    // Unmatched variant (orphan, name mismatch, etc.) — returning the aggregate
    // item.quantity would massively overstock this variant. Return 0 so the
    // variant shows out-of-stock until the seller reconciles it.
    return 0;
  }
  return channelQuantityForTracked(item.quantity, item.inventoryTracking);
}

function shopifyImageIdForUrl(product: ShopifyProduct | null | undefined, url?: string | null): number | undefined {
  if (!url || !product?.images?.length) return undefined;
  const want = url.split("?")[0];
  const hit = product.images.find((i) => i.src && (i.src === url || i.src.split("?")[0] === want));
  return hit?.id;
}

function alphanumericShopifySku(baseSku: string, labels: string[]): string {
  const base = baseSku.replace(/[^a-zA-Z0-9]/g, "").slice(0, 36);
  const suffix = labels.filter(Boolean).join("").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const combined = `${base}${suffix}`.slice(0, 50);
  return combined || base || baseSku.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
}

function cartesianVariants(
  item: SyncStoreItem,
  axes: InwVariantAxis[],
  existing?: ShopifyProduct | null
): Record<string, unknown>[] {
  const matrix = variantsToMatrix(item.variants);
  if (matrix && matrix.skus.length > 0) {
    return matrix.skus.map((sku) => {
      const labels = matrix.axes.slice(0, 3).map((a) => sku.options[a.name] ?? "");
      const baseSku = getEffectiveSku(item);
      const variant: Record<string, unknown> = {
        sku: sku.sku?.trim() || alphanumericShopifySku(baseSku, labels),
        price: shopifyPriceFromCents(sku.priceCents && sku.priceCents > 0 ? sku.priceCents : item.priceCents),
        inventory_management: shopifyInventoryManagement(item),
        inventory_quantity: channelQuantityForTracked(sku.quantity, item.inventoryTracking),
        requires_shipping: true,
      };
      if (labels[0]) variant.option1 = labels[0];
      if (labels[1]) variant.option2 = labels[1];
      if (labels[2]) variant.option3 = labels[2];
      const imageId = shopifyImageIdForUrl(existing, sku.photos?.[0]);
      if (imageId != null) variant.image_id = imageId;
      return variant;
    });
  }

  if (axes.length >= 2) {
    throw new Error(
      "INW combinations are missing SKU rows. Save the listing with Size × Color quantities before listing on Shopify."
    );
  }

  const limited = axes.slice(0, 3);
  const combos: { labels: string[]; qty: number }[] = [{ labels: [], qty: item.quantity }];

  for (const axis of limited) {
    const next: { labels: string[]; qty: number }[] = [];
    for (const combo of combos) {
      for (const opt of axis.options) {
        next.push({
          labels: [...combo.labels, opt.value],
          qty: opt.quantity,
        });
      }
    }
    combos.length = 0;
    combos.push(...next);
  }

  return combos.map((c) => {
    const baseSku = getEffectiveSku(item);
    const variant: Record<string, unknown> = {
      sku: alphanumericShopifySku(baseSku, c.labels),
      price: shopifyPriceFromCents(item.priceCents),
      inventory_management: shopifyInventoryManagement(item),
      inventory_quantity: channelQuantityForTracked(c.qty, item.inventoryTracking),
      requires_shipping: true,
    };
    if (c.labels[0]) variant.option1 = c.labels[0];
    if (c.labels[1]) variant.option2 = c.labels[1];
    if (c.labels[2]) variant.option3 = c.labels[2];
    return variant;
  });
}

/** Build `POST /products.json` body with multi-option variants when present. */
export function buildShopifyCreateBody(item: SyncStoreItem): Record<string, unknown> {
  const axes = normalizeVariantsFromProvider("shopify", item.variants) as InwVariantAxis[] | null;
  const product: Record<string, unknown> = {
    title: item.title.slice(0, 255),
    body_html: listingDescriptionForHtmlChannel(item.description, ""),
    product_type: shopifyProductTypeForInw(item.category, item.subcategory) || undefined,
  };

  if (axes && axes.length > 0) {
    product.options = axes.slice(0, 3).map((a) => ({
      name: a.name.slice(0, 255),
      values: a.options.map((o) => o.value.slice(0, 255)),
    }));
    product.variants = cartesianVariants(item, axes);
  } else {
    product.variants = [
      {
        sku: getEffectiveSku(item),
        price: shopifyPriceFromCents(item.priceCents),
        inventory_management: shopifyInventoryManagement(item),
        inventory_quantity: channelQuantityForTracked(item.quantity, item.inventoryTracking),
        requires_shipping: true,
      },
    ];
  }

  const photos = item.photos.slice(0, 10);
  if (photos.length > 0) {
    product.images = photos.map((src) => ({ src }));
  }
  return { product };
}

/** Build `PUT /products/{id}.json` for content + variants. */
export function buildShopifyUpdateBody(
  item: SyncStoreItem,
  productId: string,
  existing?: ShopifyProduct | null
): Record<string, unknown> {
  const axes = normalizeVariantsFromProvider("shopify", item.variants) as InwVariantAxis[] | null;
  const product: Record<string, unknown> = {
    id: Number(productId),
    title: item.title.slice(0, 255),
    body_html: listingDescriptionForHtmlChannel(item.description, ""),
    product_type: shopifyProductTypeForInw(item.category, item.subcategory) || undefined,
  };

  if (axes && axes.length > 0) {
    product.options = axes.slice(0, 3).map((a) => ({
      name: a.name.slice(0, 255),
      values: a.options.map((o) => o.value.slice(0, 255)),
    }));
    const built = cartesianVariants(item, axes, existing);
    product.variants = built.map((v) => {
      const existingVar = existing?.variants?.find(
        (ev) =>
          String(ev.option1 ?? "").toLowerCase() === String(v.option1 ?? "").toLowerCase() &&
          String(ev.option2 ?? "").toLowerCase() === String(v.option2 ?? "").toLowerCase() &&
          String(ev.option3 ?? "").toLowerCase() === String(v.option3 ?? "").toLowerCase()
      );
      return existingVar?.id != null ? { ...v, id: existingVar.id } : v;
    });
  } else {
    const variantId = existing?.variants?.[0]?.id ?? null;
    const variant: Record<string, unknown> = {
      sku: getEffectiveSku(item),
      price: shopifyPriceFromCents(item.priceCents),
      requires_shipping: true,
    };
    if (variantId != null) variant.id = variantId;
    product.variants = [variant];
  }

  const photos = item.photos.slice(0, 10);
  if (shopifyUpdateShouldReplaceImages(photos)) {
    product.images = photos.map((src) => ({ src }));
  }
  return { product };
}

/**
 * Shopify product update replaces the image list. Sending `{ src: shopifyCdn }`
 * without image ids recreates files and can 404 the live gallery. Only push
 * INW-hosted blobs; never re-POST marketplace CDNs.
 */
export function shopifyUpdateShouldReplaceImages(photos: string[]): boolean {
  const urls = photos.filter((url) => typeof url === "string" && url.trim().length > 0);
  if (urls.length === 0) return false;
  if (urls.every(isMarketplaceCdnPhotoUrl)) return false;
  return urls.some(isInwHostedPhotoUrl);
}

/** Map Shopify options + variants to an INW variant matrix. */
export function shopifyProductToVariants(product: ShopifyProduct): VariantMatrix | null {
  const options = product.options?.filter((o) => o.name && o.values?.length) ?? [];
  const variants = product.variants ?? [];
  if (options.length === 0 || variants.length === 0) return null;

  const axes = options.slice(0, 3).map((o) => ({
    name: o.name!.trim(),
    values: (o.values ?? []).map((v) => String(v).trim()).filter(Boolean),
  }));
  const skus = variants.map((v) => {
    const optMap: Record<string, string> = {};
    axes.forEach((axis, idx) => {
      const key = idx === 0 ? "option1" : idx === 1 ? "option2" : "option3";
      const val = String((v as Record<string, unknown>)[key] ?? "").trim();
      if (val) optMap[axis.name] = val;
    });
    const priceCents = shopifyPriceToCents(v.price);
    const photo =
      v.image?.src?.trim() ||
      product.images?.find((img) => img.id != null && img.id === v.image_id)?.src?.trim();
    return {
      options: optMap,
      quantity: Math.max(0, v.inventory_quantity ?? 0),
      ...(priceCents > 0 ? { priceCents } : {}),
      ...(v.sku?.trim() ? { sku: v.sku.trim() } : {}),
      ...(photo ? { photos: [photo] } : {}),
    };
  }).filter((s) => Object.keys(s.options).length > 0);

  if (axes.length === 0 || skus.length === 0) return null;
  const draft: VariantMatrix = { axes, skus };
  const imageAxis = pickImageVaryingAxisName(draft);
  const photosByValue: Record<string, string[]> = {};
  for (const sku of skus) {
    const value = sku.options[imageAxis];
    if (value && sku.photos?.[0] && !photosByValue[value]) photosByValue[value] = sku.photos;
  }
  const axesWithPhotos = axes.map((a) =>
    a.name === imageAxis && Object.keys(photosByValue).length > 0
      ? { ...a, photosByValue }
      : a
  );
  return {
    axes: axesWithPhotos,
    skus,
    imageAxis: Object.keys(photosByValue).length > 0 ? imageAxis : null,
    pricesVary: skus.some((s) => s.priceCents != null),
    quantitiesVary: new Set(skus.map((s) => s.quantity)).size > 1,
    skusVary: skus.some((s) => Boolean(s.sku)),
  };
}

/** Map a Shopify product to a provider-agnostic import preview entry. */
export function shopifyProductToSummary(
  product: ShopifyProduct,
  collectionName?: string | null,
  taxonomy?: ShopifyProductTaxonomyHint | null
): RemoteListingSummary {
  const variant = product.variants?.[0];
  const photos = (product.images ?? [])
    .map((i) => i.src)
    .filter((u): u is string => Boolean(u));
  const matrix = shopifyProductToVariants(product);
  const totalQty = matrix
    ? sumMatrixQuantities(matrix)
    : Math.max(0, variant?.inventory_quantity ?? 0);
  const { category, subcategory } = pickShopifyCategoryLabel(
    product,
    collectionName,
    taxonomy?.fullName
  );
  return {
    externalListingId: product.id != null ? String(product.id) : "",
    title: product.title || "Shopify product",
    description: product.body_html ?? null,
    priceCents: matrix
      ? minSkuPriceCents(matrix, shopifyPriceToCents(variant?.price))
      : shopifyPriceToCents(variant?.price),
    quantity: totalQty,
    quantityKnown: true,
    sku: variant?.sku?.trim() || null,
    photos,
    category,
    subcategory,
    remoteCategoryId: taxonomy?.gid ?? null,
    remoteUpdatedAt: product.updated_at ? new Date(product.updated_at) : null,
    variants: matrix ?? undefined,
    variantsKnown: matrix != null,
    shippingKnown: false,
  };
}
