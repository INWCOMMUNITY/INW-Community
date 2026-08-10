import { etsyGet, etsyJson } from "./client";
import { etsyPriceFromCents } from "./mapping";
import type { InwVariantAxis } from "../variant-sync";
import { normalizeVariantsFromProvider, sumVariantQuantities } from "../variant-sync";
import type { RemoteListingSummary, SyncStoreItem } from "../types";
import { hasOptionQuantities } from "@/lib/store-item-variants";

type TaxonomyProperty = {
  property_id?: number;
  name?: string;
  scales?: { scale_id?: number; display_name?: string }[];
  possible_values?: { value_id?: number; name?: string }[];
};

type EtsyInventoryOffering = {
  offering_id?: number;
  quantity?: number;
  price?: { amount?: number; divisor?: number } | number;
  is_enabled?: boolean;
  readiness_state_id?: number | null;
};

type EtsyInventoryProduct = {
  product_id?: number;
  sku?: string;
  property_values?: {
    property_id?: number;
    property_name?: string;
    scale_id?: number | null;
    value_ids?: number[];
    values?: string[];
  }[];
  offerings?: EtsyInventoryOffering[];
};

type EtsyInventory = {
  products?: EtsyInventoryProduct[];
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
  readiness_state_on_property?: number[];
};

function offeringPriceFloat(itemPriceCents: number): number {
  return Number(etsyPriceFromCents(itemPriceCents));
}

/** Lowercased option value -> quantity from all INW variant axes. */
function inwOptionQuantityMap(variants: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const axes = normalizeVariantsFromProvider("etsy", variants);
  if (!axes) return map;
  for (const axis of axes) {
    for (const opt of axis.options) {
      const key = opt.value.trim().toLowerCase();
      if (key) map.set(key, Math.max(0, Math.round(opt.quantity)));
    }
  }
  return map;
}

/** Axis that drives per-listing quantity (matches Etsy quantity_on_property when possible). */
function pickQuantityAxis(axes: InwVariantAxis[], inv: EtsyInventory): InwVariantAxis {
  const qop = inv.quantity_on_property ?? [];
  if (qop.length > 0) {
    for (const p of inv.products ?? []) {
      for (const pv of p.property_values ?? []) {
        if (pv.property_id != null && qop.includes(pv.property_id)) {
          const name = (pv.property_name ?? "").trim();
          if (name) {
            const match = axes.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
            if (match) return match;
          }
        }
      }
    }
  }
  return axes[0];
}

function productValuesForQtyProperty(
  product: EtsyInventoryProduct,
  quantityOnProperty: number[]
): string[] {
  const out: string[] = [];
  for (const pv of product.property_values ?? []) {
    if (
      quantityOnProperty.length > 0 &&
      pv.property_id != null &&
      !quantityOnProperty.includes(pv.property_id)
    ) {
      continue;
    }
    for (const v of pv.values ?? []) {
      const t = String(v).trim();
      if (t) out.push(t);
    }
  }
  if (out.length === 0) {
    for (const pv of product.property_values ?? []) {
      for (const v of pv.values ?? []) {
        const t = String(v).trim();
        if (t) out.push(t);
      }
    }
  }
  return out;
}

function resolveProductQuantity(
  product: EtsyInventoryProduct,
  optionQtys: Map<string, number>,
  quantityOnProperty: number[],
  absoluteQuantity: number,
  usePerOption: boolean
): number {
  if (!usePerOption || optionQtys.size === 0) {
    return Math.max(0, absoluteQuantity);
  }
  for (const val of productValuesForQtyProperty(product, quantityOnProperty)) {
    const q = optionQtys.get(val.trim().toLowerCase());
    if (q != null) return q;
  }
  // INW no longer has this variant — sell out on Etsy
  return 0;
}

function buildOfferingPayload(
  quantity: number,
  priceCents: number,
  defaultReadinessStateId: number | null
): Record<string, unknown> {
  const qty = Math.max(0, quantity);
  return {
    quantity: qty,
    price: offeringPriceFloat(priceCents),
    is_enabled: qty > 0,
    ...(defaultReadinessStateId != null ? { readiness_state_id: defaultReadinessStateId } : {}),
  };
}

function rebuildExistingProduct(
  product: EtsyInventoryProduct,
  quantity: number,
  item: SyncStoreItem,
  defaultReadinessStateId: number | null
): Record<string, unknown> {
  const propValues = product.property_values ?? [];
  const offerings = (product.offerings ?? []).map((o) => {
    const readinessStateId = o.readiness_state_id ?? defaultReadinessStateId;
    return {
      quantity,
      price: offeringPriceFloat(item.priceCents),
      is_enabled: quantity > 0,
      ...(readinessStateId != null ? { readiness_state_id: readinessStateId } : {}),
    };
  });
  return {
    sku: product.sku || item.id,
    property_values: propValues.map((pv) => ({
      property_id: pv.property_id,
      property_name: pv.property_name || "Option",
      value_ids: pv.value_ids ?? [],
      values: pv.values ?? [],
      ...(pv.scale_id != null ? { scale_id: pv.scale_id } : {}),
    })),
    offerings:
      offerings.length > 0
        ? offerings
        : [buildOfferingPayload(quantity, item.priceCents, defaultReadinessStateId)],
  };
}

async function fetchTaxonomyProperties(
  accessToken: string,
  taxonomyId: number
): Promise<TaxonomyProperty[]> {
  try {
    const res = await etsyGet<{ results?: TaxonomyProperty[] }>(
      accessToken,
      `/application/seller-taxonomy/nodes/${taxonomyId}/properties`
    );
    return res.results ?? [];
  } catch {
    return [];
  }
}

async function buildProductRowForOption(
  accessToken: string,
  taxonomyId: number,
  item: SyncStoreItem,
  axis: InwVariantAxis,
  opt: { value: string; quantity: number },
  defaultReadinessStateId: number | null,
  properties?: TaxonomyProperty[]
): Promise<Record<string, unknown> | null> {
  const props = properties ?? (await fetchTaxonomyProperties(accessToken, taxonomyId));
  const prop =
    props.find((p) => p.name?.toLowerCase() === axis.name.toLowerCase()) ?? props[0];
  if (!prop?.property_id) return null;

  const valueName = opt.value.trim();
  const possible = prop.possible_values?.find(
    (v) => v.name?.toLowerCase() === valueName.toLowerCase()
  );

  return {
    sku: `${item.id}-${valueName}`.slice(0, 32),
    property_values: [
      {
        property_id: prop.property_id,
        property_name: prop.name || axis.name || "Option",
        scale_id: prop.scales?.[0]?.scale_id ?? null,
        value_ids: possible?.value_id ? [possible.value_id] : [],
        values: [valueName],
      },
    ],
    offerings: [buildOfferingPayload(opt.quantity, item.priceCents, defaultReadinessStateId)],
  };
}

function inventoryPutBody(
  inv: EtsyInventory,
  products: Record<string, unknown>[]
): Record<string, unknown> {
  const body: Record<string, unknown> = { products };
  if (inv.price_on_property?.length) body.price_on_property = inv.price_on_property;
  if (inv.quantity_on_property?.length) body.quantity_on_property = inv.quantity_on_property;
  if (inv.sku_on_property?.length) body.sku_on_property = inv.sku_on_property;
  if (inv.readiness_state_on_property?.length) {
    body.readiness_state_on_property = inv.readiness_state_on_property;
  }
  return body;
}

/**
 * Push INW per-option stock (and new option rows) to an existing Etsy listing inventory.
 * Preserves Etsy's property_id structure; adds missing variation rows from taxonomy.
 */
export async function syncEtsyListingInventoryFromInw(
  accessToken: string,
  listingId: string,
  item: SyncStoreItem,
  absoluteQuantity: number,
  defaultReadinessStateId: number | null
): Promise<void> {
  const inv = await etsyGet<EtsyInventory>(
    accessToken,
    `/listings/${listingId}/inventory`
  );
  const products = inv.products ?? [];
  const optionQtys = inwOptionQuantityMap(item.variants);
  const perOption = hasOptionQuantities(item.variants) && optionQtys.size > 0;

  if (!perOption) {
    if (products.length === 0) return;
    const rebuilt = products.map((p) =>
      rebuildExistingProduct(
        p,
        Math.max(0, absoluteQuantity),
        item,
        defaultReadinessStateId
      )
    );
    await etsyJson(
      accessToken,
      `/listings/${listingId}/inventory`,
      "PUT",
      inventoryPutBody(inv, rebuilt)
    );
    return;
  }

  const axes = normalizeVariantsFromProvider("etsy", item.variants) as InwVariantAxis[];
  const quantityAxis = pickQuantityAxis(axes, inv);
  const taxonomyId = item.etsyTaxonomyId ?? 1;

  if (products.length === 0) {
    const body = await buildEtsyInventoryProducts(
      accessToken,
      taxonomyId,
      item,
      defaultReadinessStateId
    );
    if (!body) {
      throw new Error("Could not create Etsy inventory from INW variant options.");
    }
    const propId = (body.products[0] as { property_values?: { property_id?: number }[] })
      ?.property_values?.[0]?.property_id;
    const putPayload: Record<string, unknown> = { ...body };
    if (propId != null && body.products.length > 1) {
      putPayload.quantity_on_property = [propId];
      putPayload.price_on_property = [propId];
    }
    await etsyJson(accessToken, `/listings/${listingId}/inventory`, "PUT", putPayload);
    return;
  }

  // Single Etsy SKU but multiple INW options — replace inventory with full variant matrix.
  if (products.length <= 1 && quantityAxis.options.length > 1) {
    const body = await buildEtsyInventoryProducts(
      accessToken,
      taxonomyId,
      item,
      defaultReadinessStateId
    );
    if (!body) {
      throw new Error("Could not build Etsy variant inventory from INW options.");
    }
    const propId = (body.products[0] as { property_values?: { property_id?: number }[] })
      ?.property_values?.[0]?.property_id;
    const putPayload: Record<string, unknown> = { ...body };
    if (propId != null && body.products.length > 1) {
      putPayload.quantity_on_property = [propId];
      putPayload.price_on_property = [propId];
    }
    await etsyJson(accessToken, `/listings/${listingId}/inventory`, "PUT", putPayload);
    return;
  }

  const quantityOnProperty = inv.quantity_on_property ?? [];
  const rebuilt: Record<string, unknown>[] = products.map((p) => {
    const quantity = resolveProductQuantity(
      p,
      optionQtys,
      quantityOnProperty,
      absoluteQuantity,
      true
    );
    return rebuildExistingProduct(p, quantity, item, defaultReadinessStateId);
  });

  const existingValues = new Set<string>();
  for (const p of products) {
    for (const v of productValuesForQtyProperty(p, quantityOnProperty)) {
      existingValues.add(v.trim().toLowerCase());
    }
  }

  const taxonomyProps = await fetchTaxonomyProperties(accessToken, taxonomyId);
  for (const opt of quantityAxis.options) {
    const key = opt.value.trim().toLowerCase();
    if (!key || existingValues.has(key)) continue;
    const row = await buildProductRowForOption(
      accessToken,
      taxonomyId,
      item,
      quantityAxis,
      opt,
      defaultReadinessStateId,
      taxonomyProps
    );
    if (row) {
      rebuilt.push(row);
      existingValues.add(key);
    }
  }

  console.log("[etsy] syncEtsyListingInventoryFromInw", {
    listingId,
    productCount: rebuilt.length,
    inwOptions: quantityAxis.options.length,
    quantityOnProperty,
  });

  await etsyJson(
    accessToken,
    `/listings/${listingId}/inventory`,
    "PUT",
    inventoryPutBody(inv, rebuilt)
  );
}

/** Attach variant axes + quantities from Etsy inventory API to a listing summary. */
export async function enrichEtsyListingSummaryWithInventory(
  accessToken: string,
  summary: RemoteListingSummary
): Promise<void> {
  if (!summary.externalListingId) return;
  try {
    const inv = await etsyGet<EtsyInventory>(
      accessToken,
      `/listings/${summary.externalListingId}/inventory`
    );
    const variants = etsyInventoryToVariants(inv.products);
    if (!variants || variants.length === 0) return;
    summary.variants = variants;
    summary.variantsKnown = true;
    const sum = sumVariantQuantities(variants);
    if (sum > 0) {
      summary.quantity = sum;
      summary.quantityKnown = true;
    }
  } catch (e) {
    console.warn("[etsy] enrich listing inventory failed", {
      listingId: summary.externalListingId,
      error: String(e),
    });
  }
}

/** Build Etsy inventory products from INW variant axes using taxonomy property definitions. */
export async function buildEtsyInventoryProducts(
  accessToken: string,
  taxonomyId: number,
  item: SyncStoreItem,
  defaultReadinessStateId?: number | null
): Promise<{ products: Record<string, unknown>[] } | null> {
  const axes = normalizeVariantsFromProvider("etsy", item.variants) as InwVariantAxis[] | null;
  if (!axes || axes.length === 0) {
    return {
      products: [
        {
          sku: item.id,
          property_values: [],
          offerings: [
            buildOfferingPayload(
              item.quantity,
              item.priceCents,
              defaultReadinessStateId ?? null
            ),
          ],
        },
      ],
    };
  }

  const properties = await fetchTaxonomyProperties(accessToken, taxonomyId);
  if (properties.length === 0) return null;

  const products: Record<string, unknown>[] = [];
  const primaryAxis = axes[0];
  for (const opt of primaryAxis.options) {
    const row = await buildProductRowForOption(
      accessToken,
      taxonomyId,
      item,
      primaryAxis,
      opt,
      defaultReadinessStateId ?? null,
      properties
    );
    if (row) products.push(row);
  }

  if (products.length === 0) return null;
  return { products };
}

export async function pushEtsyVariants(
  accessToken: string,
  listingId: string,
  taxonomyId: number,
  item: SyncStoreItem,
  defaultReadinessStateId?: number | null
): Promise<void> {
  const readiness = defaultReadinessStateId ?? null;
  if (hasOptionQuantities(item.variants)) {
    await syncEtsyListingInventoryFromInw(
      accessToken,
      listingId,
      item,
      item.quantity,
      readiness
    );
    return;
  }
  const body = await buildEtsyInventoryProducts(accessToken, taxonomyId, item, readiness);
  if (!body) return;
  console.log("[etsy] pushing variants", {
    listingId,
    productCount: body.products.length,
    defaultReadinessStateId: readiness,
  });
  await etsyJson(accessToken, `/listings/${listingId}/inventory`, "PUT", body);
}

/** Normalize Etsy inventory products to INW variant axes. */
export function etsyInventoryToVariants(products: unknown): InwVariantAxis[] | null {
  if (!Array.isArray(products) || products.length === 0) return null;

  // One row per inventory product (variation SKU) — correct for quantity-on-property listings.
  if (
    products.length > 1 ||
    ((products[0] as EtsyInventoryProduct).property_values?.length ?? 0) > 0
  ) {
    const byAxis = new Map<string, Map<string, number>>();
    for (const p of products as EtsyInventoryProduct[]) {
      const qty = Math.max(0, p.offerings?.[0]?.quantity ?? 0);
      const pvs = p.property_values ?? [];
      if (pvs.length === 0) continue;
      const pv = pvs[0];
      const name = (pv.property_name ?? "Option").trim();
      const val = pv.values?.[0]?.trim();
      if (!name || !val) continue;
      const axis = byAxis.get(name) ?? new Map<string, number>();
      axis.set(val, qty);
      byAxis.set(name, axis);
    }
    if (byAxis.size === 0) return null;
    return [...byAxis.entries()].map(([name, valueMap]) => ({
      name,
      options: [...valueMap.entries()].map(([value, quantity]) => ({ value, quantity })),
    }));
  }

  const axisMap = new Map<string, { value: string; quantity: number }[]>();
  for (const p of products as EtsyInventoryProduct[]) {
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
