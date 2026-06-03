import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { normalizeVariantsFromProvider, type InwVariantAxis } from "../variant-sync";

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
};

export type ShopifyProduct = {
  id?: number;
  title?: string;
  body_html?: string | null;
  product_type?: string | null;
  updated_at?: string;
  options?: { name?: string; values?: string[] }[];
  variants?: ShopifyVariant[];
  images?: { src?: string }[];
};

function cartesianVariants(
  item: SyncStoreItem,
  axes: InwVariantAxis[]
): Record<string, unknown>[] {
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
    const skuSuffix = c.labels.join("-").replace(/\s+/g, "_").slice(0, 40);
    const variant: Record<string, unknown> = {
      sku: skuSuffix ? `${item.id}-${skuSuffix}`.slice(0, 64) : item.id,
      price: shopifyPriceFromCents(item.priceCents),
      inventory_management: "shopify",
      inventory_quantity: Math.max(0, c.qty),
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
    body_html: item.description?.trim() || "",
    product_type: item.category?.trim() || undefined,
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
        sku: item.id,
        price: shopifyPriceFromCents(item.priceCents),
        inventory_management: "shopify",
        inventory_quantity: Math.max(0, item.quantity),
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
    body_html: item.description?.trim() || "",
    product_type: item.category?.trim() || undefined,
  };

  if (axes && axes.length > 0) {
    product.options = axes.slice(0, 3).map((a) => ({
      name: a.name.slice(0, 255),
      values: a.options.map((o) => o.value.slice(0, 255)),
    }));
    const built = cartesianVariants(item, axes);
    product.variants = built.map((v, i) => {
      const existingVar = existing?.variants?.[i];
      return existingVar?.id != null ? { ...v, id: existingVar.id } : v;
    });
  } else {
    const variantId = existing?.variants?.[0]?.id ?? null;
    const variant: Record<string, unknown> = {
      sku: item.id,
      price: shopifyPriceFromCents(item.priceCents),
      requires_shipping: true,
    };
    if (variantId != null) variant.id = variantId;
    product.variants = [variant];
  }

  const photos = item.photos.slice(0, 10);
  if (photos.length > 0) {
    product.images = photos.map((src) => ({ src }));
  }
  return { product };
}

/** Map Shopify options + variants to INW variant axes. */
export function shopifyProductToVariants(product: ShopifyProduct): InwVariantAxis[] | null {
  const options = product.options?.filter((o) => o.name && o.values?.length) ?? [];
  const variants = product.variants ?? [];
  if (options.length === 0 || variants.length === 0) return null;

  const axes: InwVariantAxis[] = options.slice(0, 3).map((o, idx) => {
    const key = idx === 0 ? "option1" : idx === 1 ? "option2" : "option3";
    const valueQty = new Map<string, number>();
    for (const v of variants) {
      const val = String((v as Record<string, unknown>)[key] ?? "").trim();
      if (!val) continue;
      valueQty.set(val, (valueQty.get(val) ?? 0) + Math.max(0, v.inventory_quantity ?? 0));
    }
    return {
      name: o.name!.trim(),
      options: [...valueQty.entries()].map(([value, quantity]) => ({ value, quantity })),
    };
  });
  return axes.some((a) => a.options.length > 0) ? axes : null;
}

/** Map a Shopify product to a provider-agnostic import preview entry. */
export function shopifyProductToSummary(product: ShopifyProduct): RemoteListingSummary {
  const variant = product.variants?.[0];
  const photos = (product.images ?? [])
    .map((i) => i.src)
    .filter((u): u is string => Boolean(u));
  const vars = shopifyProductToVariants(product);
  const totalQty = vars
    ? vars.reduce((s, a) => s + a.options.reduce((n, o) => n + o.quantity, 0), 0)
    : Math.max(0, variant?.inventory_quantity ?? 0);
  return {
    externalListingId: product.id != null ? String(product.id) : "",
    title: product.title || "Shopify product",
    description: product.body_html ?? null,
    priceCents: shopifyPriceToCents(variant?.price),
    quantity: totalQty,
    photos,
    category: product.product_type?.trim() || null,
    remoteUpdatedAt: product.updated_at ? new Date(product.updated_at) : null,
    variants: vars ?? undefined,
    variantsKnown: vars != null,
    shippingKnown: false,
  };
}
