import type { RemoteListingSummary, SyncStoreItem } from "../types";

/** cents -> "12.34" (Wix expects a string decimal amount). */
export function wixPriceFromCents(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

export function wixPriceToCents(amount?: string | null): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Plain HTML for plainDescription (Wix converts it to rich content). */
function descriptionHtml(item: SyncStoreItem): string | undefined {
  const text = (item.description ?? "").trim();
  return text ? text : undefined;
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
  actualPriceRange?: { minValue?: { amount?: string }; maxValue?: { amount?: string } };
  media?: { main?: WixProductMedia; itemsInfo?: { items?: WixProductMedia[] } };
  variantsInfo?: { variants?: WixVariant[] };
  inventory?: { availabilityStatus?: string };
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
    physicalProperties: {},
    variantsInfo: {
      variants: [
        {
          sku: item.id,
          price: { actualPrice: { amount: wixPriceFromCents(item.priceCents) } },
          inventoryItem: { quantity: Math.max(0, item.quantity) },
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
    sku: item.id,
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
  const main = product.media?.main;
  const mainUrl = main?.url || main?.image?.url;
  if (mainUrl) urls.push(mainUrl);
  for (const it of product.media?.itemsInfo?.items ?? []) {
    const u = it.url || it.image?.url;
    if (u && !urls.includes(u)) urls.push(u);
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
    stock?: { quantity?: number; inStock?: boolean; trackInventory?: boolean };
    media?: { image?: { url?: string } };
  }[];
};

function v1Photos(product: WixV1Product): string[] {
  const urls: string[] = [];
  const main = product.media?.mainMedia?.image?.url;
  if (main) urls.push(main);
  for (const it of product.media?.items ?? []) {
    const u = it.image?.url;
    if (u && !urls.includes(u)) urls.push(u);
  }
  const v0 = product.variants?.[0]?.media?.image?.url;
  if (v0 && !urls.includes(v0)) urls.push(v0);
  return urls;
}

function v1PriceCents(product: WixV1Product): number {
  const fromData = product.priceData?.price;
  if (typeof fromData === "number" && Number.isFinite(fromData)) return Math.round(fromData * 100);
  if (typeof product.price === "number" && Number.isFinite(product.price)) return Math.round(product.price * 100);
  const v = product.variants?.[0];
  const vp = v?.priceData?.price ?? v?.price;
  if (typeof vp === "number" && Number.isFinite(vp)) return Math.round(vp * 100);
  return 0;
}

function v1Quantity(product: WixV1Product): number {
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
export function wixV1ProductToSummary(product: WixV1Product): RemoteListingSummary {
  const desc = (product.description ?? "").trim();
  return {
    externalListingId: product.id || "",
    title: product.name || "Wix product",
    description: desc || null,
    priceCents: v1PriceCents(product),
    quantity: v1Quantity(product),
    photos: v1Photos(product),
  };
}

/** Classic Catalog v1 PATCH body for title, price, description, and stock. */
export function buildWixV1UpdateBody(item: SyncStoreItem): Record<string, unknown> {
  const qty = Math.max(0, item.quantity);
  const product: Record<string, unknown> = {
    name: item.title.slice(0, 80),
    description: (item.description ?? "").trim() || undefined,
    priceData: { price: Math.max(0, item.priceCents) / 100 },
    stock: { trackInventory: true, quantity: qty, inStock: qty > 0 },
  };
  return { product };
}

/** Catalog rows hidden on Wix should not drive INW import or inbound sync. */
export function isWixProductVisibleOnSite(product: WixProduct | WixV1Product): boolean {
  const visible = (product as WixProduct).visible ?? (product as WixV1Product).visible;
  return visible !== false;
}

/** Map a Wix product (from Search/Query Products) to a provider-agnostic import preview entry. */
export function wixProductToSummary(product: WixProduct): RemoteListingSummary {
  const priceAmount =
    product.actualPriceRange?.minValue?.amount ??
    product.variantsInfo?.variants?.[0]?.price?.actualPrice?.amount;
  // Search/Query Products doesn't return per-variant inventory; infer a sensible default so the
  // imported StoreItem isn't accidentally created as sold-out.
  const inStock = product.inventory?.availabilityStatus !== "OUT_OF_STOCK";
  return {
    externalListingId: product.id || "",
    title: product.name || "Wix product",
    description: null,
    priceCents: wixPriceToCents(priceAmount),
    quantity: inStock ? 1 : 0,
    photos: firstMediaUrl(product),
  };
}
