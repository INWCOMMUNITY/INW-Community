import { etsyGet, etsyJson } from "./client";
import { etsyPriceFromCents } from "./mapping";
import type { InwVariantAxis } from "../variant-sync";
import { normalizeVariantsFromProvider } from "../variant-sync";
import type { SyncStoreItem } from "../types";

type TaxonomyProperty = {
  property_id?: number;
  name?: string;
  scales?: { scale_id?: number; display_name?: string }[];
  possible_values?: { value_id?: number; name?: string }[];
};

/** Build Etsy inventory products from INW variant axes using taxonomy property definitions. */
export async function buildEtsyInventoryProducts(
  accessToken: string,
  taxonomyId: number,
  item: SyncStoreItem
): Promise<{ products: Record<string, unknown>[] } | null> {
  const axes = normalizeVariantsFromProvider("etsy", item.variants) as InwVariantAxis[] | null;
  if (!axes || axes.length === 0) {
    return {
      products: [
        {
          sku: item.id,
          property_values: [],
          offerings: [
            {
              price: Number(etsyPriceFromCents(item.priceCents)),
              quantity: Math.max(0, item.quantity),
              is_enabled: item.quantity > 0,
            },
          ],
        },
      ],
    };
  }

  let properties: TaxonomyProperty[] = [];
  try {
    const res = await etsyGet<{ results?: TaxonomyProperty[] }>(
      accessToken,
      `/application/seller-taxonomy/nodes/${taxonomyId}/properties`
    );
    properties = res.results ?? [];
  } catch {
    return null;
  }

  const products: Record<string, unknown>[] = [];
  const primaryAxis = axes[0];
  for (const opt of primaryAxis.options) {
    const prop =
      properties.find((p) => p.name?.toLowerCase() === primaryAxis.name.toLowerCase()) ??
      properties[0];
    if (!prop?.property_id) continue;

    const valueName = opt.value;
    const possible = prop.possible_values?.find(
      (v) => v.name?.toLowerCase() === valueName.toLowerCase()
    );

    products.push({
      sku: `${item.id}-${valueName}`.slice(0, 32),
      property_values: [
        {
          property_id: prop.property_id,
          property_name: prop.name,
          scale_id: prop.scales?.[0]?.scale_id ?? null,
          value_ids: possible?.value_id ? [possible.value_id] : [],
          values: [valueName],
        },
      ],
      offerings: [
        {
          price: Number(etsyPriceFromCents(item.priceCents)),
          quantity: Math.max(0, opt.quantity),
          is_enabled: opt.quantity > 0,
        },
      ],
    });
  }

  if (products.length === 0) return null;
  return { products };
}

export async function pushEtsyVariants(
  accessToken: string,
  listingId: string,
  taxonomyId: number,
  item: SyncStoreItem
): Promise<void> {
  const body = await buildEtsyInventoryProducts(accessToken, taxonomyId, item);
  if (!body) return;
  await etsyJson(accessToken, `/listings/${listingId}/inventory`, "PUT", body);
}

/** Normalize Etsy inventory products to INW variant axes. */
export function etsyInventoryToVariants(products: unknown): InwVariantAxis[] | null {
  if (!Array.isArray(products) || products.length === 0) return null;
  const axisMap = new Map<string, { value: string; quantity: number }[]>();

  for (const p of products as {
    property_values?: { property_name?: string; values?: string[] }[];
    offerings?: { quantity?: number }[];
  }[]) {
    const qty = Math.max(0, p.offerings?.[0]?.quantity ?? 0);
    for (const pv of p.property_values ?? []) {
      const name = (pv.property_name ?? "Option").trim();
      const val = pv.values?.[0]?.trim();
      if (!val) continue;
      const list = axisMap.get(name) ?? [];
      list.push({ value: val, quantity: qty });
      axisMap.set(name, list);
    }
  }

  if (axisMap.size === 0) return null;
  return [...axisMap.entries()].map(([name, options]) => ({ name, options }));
}
