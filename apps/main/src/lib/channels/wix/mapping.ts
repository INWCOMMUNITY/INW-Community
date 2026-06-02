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
