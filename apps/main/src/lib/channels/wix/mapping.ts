import { wixOriginalMediaUrl } from "@/lib/business-photos";
import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { hasOptionQuantities } from "../../store-item-variants";
import { listingDescriptionForHtmlChannel } from "../rich-description";

/** cents -> "12.34" (Wix expects a string decimal amount). */
export function wixPriceFromCents(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

export function wixPriceToCents(amount?: string | null): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Sanitized HTML for plainDescription (Wix converts it to rich content). */
function descriptionHtml(item: SyncStoreItem): string | undefined {
  const html = listingDescriptionForHtmlChannel(item.description, "");
  return html.trim() ? html : undefined;
}

export type WixProductMedia = { url?: string; image?: { url?: string }; mediaType?: string };
export type WixVariant = {
  id?: string;
  sku?: string;
  price?: { actualPrice?: { amount?: string } };
};
export type WixProduct = {
  id?: string;
  revision?: string;
  name?: string;
  visible?: boolean;
  slug?: string;
  plainDescription?: string;
  description?: string;
  actualPriceRange?: { minValue?: { amount?: string }; maxValue?: { amount?: string } };
  media?: { main?: WixProductMedia; itemsInfo?: { items?: WixProductMedia[] } };
  variantsInfo?: { variants?: WixVariant[] };
  inventory?: { availabilityStatus?: string };
  /** Optional collection / category labels when catalog returns them. */
  categories?: { id?: string; name?: string }[];
  collectionIds?: string[];
  ribbon?: string;
  createdDate?: string;
  updatedDate?: string;
};

/**
 * Build the `POST /stores/v3/products-with-inventory` body for a StoreItem. v1 maps a single
 * variant (one price/qty); options-based variants are out of scope. Media is set via external URL
 * (Wix imports each URL), and the variant SKU is set to the StoreItem id for reverse lookup.
 */
export function buildWixCreateBody(item: SyncStoreItem): Record<string, unknown> {
  const photos = item.photos.slice(0, 12);
  const product: Record<string, unknown> = {
    name: item.title.slice(0, 80),
    productType: "PHYSICAL",
    visible: true,
    physicalProperties: {},
    variantsInfo: {
      variants: [
        {
          sku: getEffectiveSku(item),
          price: { actualPrice: { amount: wixPriceFromCents(item.priceCents) } },
          inventoryItem: {
            trackQuantity: true,
            quantity: Math.max(0, item.quantity),
            inStock: item.quantity > 0,
          },
          physicalProperties: {},
        },
      ],
    },
  };
  const desc = descriptionHtml(item);
  if (desc) product.plainDescription = desc;
  if (photos.length > 0) {
    product.media = { itemsInfo: { items: photos.map((url) => ({ url })) } };
  }
  return { product };
}

/**
 * Build the `PATCH /stores/v3/products/{id}` body. The current `revision` and the existing variant
 * id are required by Wix (optimistic concurrency); inventory is updated separately.
 */
export function buildWixUpdateBody(
  item: SyncStoreItem,
  revision: string,
  variantId: string | null
): Record<string, unknown> {
  const photos = item.photos.slice(0, 12);
  const variant: Record<string, unknown> = {
    sku: getEffectiveSku(item),
    price: { actualPrice: { amount: wixPriceFromCents(item.priceCents) } },
  };
  if (variantId) variant.id = variantId;
  const product: Record<string, unknown> = {
    revision,
    name: item.title.slice(0, 80),
    variantsInfo: { variants: [variant] },
  };
  const desc = descriptionHtml(item);
  if (desc) product.plainDescription = desc;
  if (photos.length > 0) {
    product.media = { itemsInfo: { items: photos.map((url) => ({ url })) } };
  }
  return { product };
}

function firstMediaUrl(product: WixProduct): string[] {
  const urls: string[] = [];
  const push = (raw?: string) => {
    if (!raw) return;
    const url = wixOriginalMediaUrl(raw);
    if (url && !urls.includes(url)) urls.push(url);
  };
  const main = product.media?.main;
  push(main?.url || main?.image?.url);
  for (const it of product.media?.itemsInfo?.items ?? []) {
    push(it.url || it.image?.url);
  }
  return urls;
}

/** Catalog v1 product shape (classic Editor / stores-reader). */
export type WixV1Product = {
  id?: string;
  name?: string;
  visible?: boolean;
  description?: string;
  price?: number;
  priceData?: { price?: number; currency?: string };
  media?: { mainMedia?: { image?: { url?: string } }; items?: { image?: { url?: string } }[] };
  stock?: { quantity?: number; trackInventory?: boolean; inStock?: boolean };
  variants?: {
    id?: string;
    price?: number;
    priceData?: { price?: number };
    stock?: { quantity?: number; inStock?: boolean; trackInventory?: boolean; trackQuantity?: boolean };
    media?: { image?: { url?: string } };
    /** v1 API: option name -> choice value (not an array). */
    choices?: Record<string, string> | { description?: string; value?: string }[];
    variant?: { choices?: { description?: string }[] };
  }[];
  productOptions?: {
    name?: string;
    optionType?: string;
    choices?: { description?: string; value?: string; inStock?: boolean }[];
  }[];
  manageVariants?: boolean;
  productType?: string;
  ribbon?: string;
  /** Collection ids the product belongs to (when returned by query/GET). */
  collectionIds?: string[];
  additionalInfoSections?: { title?: string; description?: string }[];
  shippingWeight?: number;
  lastUpdated?: string;
  numericId?: string;
};

/** True when a Wix productType/ribbon string is not a useful category label. */
export function isWixNoiseCategoryLabel(label: string | null | undefined): boolean {
  if (!label?.trim()) return true;
  const n = label.trim().toLowerCase();
  return (
    n === "physical" ||
    n === "digital" ||
    n === "service" ||
    n === "unspecified" ||
    n === "other"
  );
}

/** Parse a Wix ISO timestamp into a Date (null when absent/invalid). */
function parseWixDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function v1Photos(product: WixV1Product): string[] {
  const urls: string[] = [];
  const push = (raw?: string) => {
    if (!raw) return;
    const url = wixOriginalMediaUrl(raw);
    if (url && !urls.includes(url)) urls.push(url);
  };
  push(product.media?.mainMedia?.image?.url);
  for (const it of product.media?.items ?? []) {
    push(it.image?.url);
  }
  push(product.variants?.[0]?.media?.image?.url);
  return urls;
}

function v1PriceCents(product: WixV1Product): number {
  const fromData = product.priceData?.price;
  if (typeof fromData === "number" && Number.isFinite(fromData) && fromData > 0) {
    return Math.round(fromData * 100);
  }
  if (typeof product.price === "number" && Number.isFinite(product.price) && product.price > 0) {
    return Math.round(product.price * 100);
  }
  for (const v of product.variants ?? []) {
    const vp = v.priceData?.price ?? v.price;
    if (typeof vp === "number" && Number.isFinite(vp) && vp > 0) {
      return Math.round(vp * 100);
    }
  }
  return 0;
}

export function v1Quantity(product: WixV1Product): number {
  const stock = product.stock;
  if (stock?.trackInventory && typeof stock.quantity === "number") {
    return Math.max(0, stock.quantity);
  }
  const vStock = product.variants?.[0]?.stock;
  if (vStock?.trackInventory !== false && typeof vStock?.quantity === "number") {
    return Math.max(0, vStock.quantity);
  }
  if (stock?.inStock === false) return 0;
  if (vStock?.inStock === false) return 0;
  return 1;
}

/** Map a Catalog v1 product to an import preview entry (classic Wix Stores sites). */
export function wixV1ProductToSummary(
  product: WixV1Product,
  collectionNameById?: Map<string, string>
): RemoteListingSummary {
  const desc = (product.description ?? "").trim();
  const ribbon = product.ribbon?.trim() || null;
  const fromCollections =
    product.collectionIds
      ?.map((id) => collectionNameById?.get(id))
      .find((n) => n && !isWixNoiseCategoryLabel(n)) ?? null;
  const productType = product.productType?.trim() || null;
  const categoryLabel =
    (ribbon && !isWixNoiseCategoryLabel(ribbon) ? ribbon : null) ||
    fromCollections ||
    (productType && !isWixNoiseCategoryLabel(productType) ? productType : null);
  return {
    externalListingId: product.id || "",
    title: product.name || "Wix product",
    description: desc || null,
    priceCents: v1PriceCents(product),
    quantity: v1Quantity(product),
    quantityKnown: true,
    photos: v1Photos(product),
    remoteUpdatedAt: parseWixDate(product.lastUpdated),
    category: categoryLabel,
    remoteCategoryId: product.collectionIds?.[0] ?? null,
    variantsKnown: false,
    shippingKnown: false,
  };
}

/** Stock fields for Catalog v1 products and variants (`trackInventory`, not v2's `trackQuantity`). */
export function buildWixV1StockFields(quantity: number): Record<string, unknown> {
  const qty = Math.max(0, Math.round(quantity));
  return { trackInventory: true, quantity: qty, inStock: qty > 0 };
}

/** Catalog v1 media block (external image URLs). */
export function buildWixV1MediaFromPhotos(photos: string[]): Record<string, unknown> | undefined {
  const urls = photos.filter(Boolean).slice(0, 12);
  if (urls.length === 0) return undefined;
  const [first, ...rest] = urls;
  const media: Record<string, unknown> = {
    mainMedia: { image: { url: first } },
  };
  if (rest.length > 0) {
    media.items = rest.map((url) => ({ image: { url } }));
  }
  return media;
}

/** Catalog v1 create body (`POST /stores/v1/products`). */
export function buildWixV1CreateBody(item: SyncStoreItem): Record<string, unknown> {
  const product: Record<string, unknown> = {
    name: item.title.slice(0, 80),
    productType: "physical",
    visible: true,
    priceData: { price: Math.max(0, item.priceCents) / 100 },
    stock: buildWixV1StockFields(item.quantity),
  };
  if (item.category?.trim()) product.ribbon = item.category.trim().slice(0, 40);
  const desc = (item.description ?? "").trim();
  if (desc) product.description = desc;
  const media = buildWixV1MediaFromPhotos(item.photos);
  if (media) product.media = media;
  return { product };
}

/**
 * Classic Catalog v1 PATCH body. When `existing` has variants, set stock on each variant
 * (required for multi-option products on Editor sites) unless INW uses per-option quantities —
 * then stock is pushed separately via `buildWixV1OptionsBody` to avoid wiping sizes with total qty.
 */
export function buildWixV1UpdateBody(
  item: SyncStoreItem,
  existing?: WixV1Product | null
): Record<string, unknown> {
  const perOptionStock = hasOptionQuantities(item.variants);
  const stock = buildWixV1StockFields(item.quantity);
  const price = Math.max(0, item.priceCents) / 100;
  const product: Record<string, unknown> = {
    name: item.title.slice(0, 80),
    description: (item.description ?? "").trim() || undefined,
    priceData: { price },
  };
  const media = buildWixV1MediaFromPhotos(item.photos);
  if (media) product.media = media;
  const variantRows = existing?.variants?.filter((v) => v.id) ?? [];
  if (variantRows.length > 0) {
    product.variants = variantRows.map((v) => ({
      id: v.id,
      ...(perOptionStock ? {} : { stock }),
      priceData: { price },
    }));
  } else if (!perOptionStock) {
    product.stock = stock;
  }
  return { product };
}

/**
 * Catalog v1 PATCH for inventory only — never send price/name/description (a zero-price stub
 * was wiping real prices when inventory sync fell back to this path).
 */
export function buildWixV1InventoryOnlyBody(
  quantity: number,
  existing?: WixV1Product | null
): Record<string, unknown> | null {
  const stock = buildWixV1StockFields(quantity);
  const variantRows = existing?.variants?.filter((v) => v.id) ?? [];
  if (variantRows.length > 1) {
    // Never apply one aggregate stock value to every variant row (inflation loop).
    return null;
  }
  if (variantRows.length === 1) {
    return { product: { variants: variantRows.map((v) => ({ id: v.id, stock })) } };
  }
  return { product: { stock } };
}

/** Catalog rows hidden on Wix should not drive INW import or inbound sync. */
export function isWixProductVisibleOnSite(product: WixProduct | WixV1Product): boolean {
  const visible = (product as WixProduct).visible ?? (product as WixV1Product).visible;
  return visible !== false;
}

/** Map a Wix product (from Search/Query Products) to a provider-agnostic import preview entry. */
export function wixProductToSummary(
  product: WixProduct,
  collectionNameById?: Map<string, string>
): RemoteListingSummary {
  const priceAmount =
    product.actualPriceRange?.minValue?.amount ??
    product.variantsInfo?.variants?.[0]?.price?.actualPrice?.amount;
  const desc = (product.plainDescription ?? product.description ?? "").trim();
  const fromCategories = product.categories?.find((c) => c.name && !isWixNoiseCategoryLabel(c.name))
    ?.name;
  const fromCollectionIds =
    product.collectionIds
      ?.map((id) => collectionNameById?.get(id))
      .find((n) => n && !isWixNoiseCategoryLabel(n)) ?? null;
  const ribbon = product.ribbon?.trim() || null;
  const categoryLabel =
    (ribbon && !isWixNoiseCategoryLabel(ribbon) ? ribbon : null) ||
    fromCategories ||
    fromCollectionIds ||
    null;
  // Search/Query Products doesn't return per-variant inventory; quantity is merged in separately.
  const firstVariantSku = product.variantsInfo?.variants?.[0]?.sku?.trim() || null;
  return {
    externalListingId: product.id || "",
    title: product.name || "Wix product",
    sku: firstVariantSku,
    description: desc || null,
    priceCents: wixPriceToCents(priceAmount),
    quantity: 0,
    quantityKnown: false,
    photos: firstMediaUrl(product),
    remoteUpdatedAt: parseWixDate(product.updatedDate),
    category: categoryLabel,
    remoteCategoryId: product.categories?.[0]?.id ?? product.collectionIds?.[0] ?? null,
  };
}
