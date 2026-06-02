import type { RemoteListingSummary, SyncStoreItem } from "../types";
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
};

export type ShopifyProduct = {
  id?: number;
  title?: string;
  body_html?: string | null;
  variants?: ShopifyVariant[];
  images?: { src?: string }[];
};

/** Build `POST /products.json` body for a single-variant product (v1). */
export function buildShopifyCreateBody(item: SyncStoreItem): Record<string, unknown> {
  const product: Record<string, unknown> = {
    title: item.title.slice(0, 255),
    body_html: item.description?.trim() || "",
    variants: [
      {
        sku: item.id,
        price: shopifyPriceFromCents(item.priceCents),
        inventory_management: "shopify",
        inventory_quantity: Math.max(0, item.quantity),
      },
    ],
  };
  const photos = item.photos.slice(0, 10);
  if (photos.length > 0) {
    product.images = photos.map((src) => ({ src }));
  }
  return { product };
}

/** Build `PUT /products/{id}.json` for content + variant price/SKU (inventory set separately). */
export function buildShopifyUpdateBody(
  item: SyncStoreItem,
  productId: string,
  variantId: number | null
): Record<string, unknown> {
  const variant: Record<string, unknown> = {
    sku: item.id,
    price: shopifyPriceFromCents(item.priceCents),
  };
  if (variantId != null) variant.id = variantId;
  const product: Record<string, unknown> = {
    id: Number(productId),
    title: item.title.slice(0, 255),
    body_html: item.description?.trim() || "",
    variants: [variant],
  };
  const photos = item.photos.slice(0, 10);
  if (photos.length > 0) {
    product.images = photos.map((src) => ({ src }));
  }
  return { product };
}

/** Map a Shopify product to a provider-agnostic import preview entry (first variant). */
export function shopifyProductToSummary(product: ShopifyProduct): RemoteListingSummary {
  const variant = product.variants?.[0];
  const photos = (product.images ?? [])
    .map((i) => i.src)
    .filter((u): u is string => Boolean(u));
  return {
    externalListingId: product.id != null ? String(product.id) : "",
    title: product.title || "Shopify product",
    description: product.body_html ?? null,
    priceCents: shopifyPriceToCents(variant?.price),
    quantity: Math.max(0, variant?.inventory_quantity ?? 0),
    photos,
  };
}
