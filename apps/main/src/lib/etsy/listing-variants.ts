/**
 * INW StoreVariant.options → Etsy listing inventory products[] (Size×Color matrix).
 * Mirrors Shopify multi-variant export correlation, via Etsy PUT inventory.
 */
import { trackedAvailable } from "database";
import {
  MAX_ETSY_AXES,
  MAX_ETSY_SKUS_ALL_PROPERTIES,
  skuSelectionKey,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

export type EtsyStoreVariantRow = {
  id: string;
  options: unknown;
  priceCents: number;
  sku: string | null;
  inventory?: {
    mode: string;
    onHand: number | null;
    reserved: number | null;
  } | null;
};

export type EtsyInventoryPropertyValue = {
  property_id: number;
  property_name: string;
  values: string[];
  value_ids?: number[];
  scale_id?: number | null;
};

export type EtsyInventoryProductInput = {
  sku: string;
  property_values: EtsyInventoryPropertyValue[];
  offerings: Array<{
    price: number;
    quantity: number;
    is_enabled: boolean;
    readiness_state_id?: number | string;
  }>;
};

export type EtsyRemoteInventoryProduct = {
  product_id?: number | string;
  sku?: string | null;
  property_values?: Array<{
    property_id?: number;
    property_name?: string;
    values?: string[];
    value_ids?: number[];
    scale_id?: number | null;
  }>;
  offerings?: Array<{
    offering_id?: number | string;
    quantity?: number;
    is_enabled?: boolean;
    price?: unknown;
  }>;
};

/** Well-known Etsy variation property ids used when taxonomy lookup misses. */
const FALLBACK_PROPERTY_IDS: Record<string, number> = {
  size: 100,
  color: 200,
  colour: 200,
  material: 507,
  style: 46803063641,
  pattern: 46803063659,
};

export function parseStoreVariantOptions(raw: unknown): Record<string, string> | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const name = String(k ?? "").trim();
    const val = v == null ? "" : String(v).trim();
    if (!name || !val) continue;
    out[name] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function sellableQtyForEtsyVariant(
  variant: EtsyStoreVariantRow,
  inventoryTracking: string | null | undefined
): number {
  if (inventoryTracking === "made_to_order") {
    return Math.max(1, 999);
  }
  const state = variant.inventory;
  if (state?.mode === "TRACKED_FINITE" && state.onHand != null && state.reserved != null) {
    try {
      return Math.max(0, trackedAvailable(state.onHand, state.reserved));
    } catch {
      /* fall through */
    }
  }
  return 0;
}

/**
 * Fail-closed validation for List on Etsy when multiple StoreVariants exist.
 */
export function validateEtsyExportVariants(input: {
  variants: EtsyStoreVariantRow[];
}): { ok: true; multi: boolean; axisNames: string[] } | { ok: false; message: string } {
  const { variants } = input;
  if (variants.length < 1) {
    return { ok: false, message: "Etsy export requires at least one ACTIVE variant" };
  }
  if (variants.length > MAX_ETSY_SKUS_ALL_PROPERTIES) {
    return {
      ok: false,
      message: `Etsy export supports at most ${MAX_ETSY_SKUS_ALL_PROPERTIES} variants; found ${variants.length}`,
    };
  }
  if (variants.length === 1) {
    return { ok: true, multi: false, axisNames: [] };
  }

  const axisNames = new Set<string>();
  for (const v of variants) {
    const opts = parseStoreVariantOptions(v.options);
    if (!opts) {
      return {
        ok: false,
        message:
          "Multi-variant Etsy export requires Size/Color (or other) options on every variant. Fix the listing matrix, then re-list.",
      };
    }
    if (Object.keys(opts).length > MAX_ETSY_AXES) {
      return {
        ok: false,
        message: `Etsy supports at most ${MAX_ETSY_AXES} variation axes; found ${Object.keys(opts).length}`,
      };
    }
    for (const name of Object.keys(opts)) axisNames.add(name);
  }
  if (axisNames.size < 1 || axisNames.size > MAX_ETSY_AXES) {
    return {
      ok: false,
      message: `Etsy supports 1–${MAX_ETSY_AXES} variation axes; found ${axisNames.size}`,
    };
  }
  for (const v of variants) {
    const opts = parseStoreVariantOptions(v.options)!;
    for (const axis of axisNames) {
      if (!Object.keys(opts).some((k) => k.trim().toLowerCase() === axis.trim().toLowerCase())) {
        return {
          ok: false,
          message: `Variant is missing option axis "${axis}" required for Etsy export`,
        };
      }
    }
    if (!(typeof v.priceCents === "number" && v.priceCents > 0)) {
      return { ok: false, message: "Every variant needs a price greater than zero for Etsy" };
    }
  }
  return { ok: true, multi: true, axisNames: [...axisNames] };
}

type TaxonomyProperty = {
  property_id?: number;
  name?: string;
  display_name?: string;
  scales?: Array<{ scale_id?: number; display_name?: string; name?: string }>;
  possible_values?: Array<{ value_id?: number; name?: string }>;
};

export async function resolveEtsyVariationPropertyIds(input: {
  connectionId: string;
  memberId: string;
  taxonomyId: number;
  axisNames: string[];
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<Map<string, { propertyId: number; scaleId: number | null }>> {
  const out = new Map<string, { propertyId: number; scaleId: number | null }>();
  const res = await etsyConnectionRequest<{ results?: TaxonomyProperty[]; count?: number }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/seller-taxonomy/nodes/${encodeURIComponent(String(input.taxonomyId))}/properties`,
    maxAttempts: 2,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  const results = res.ok && Array.isArray(res.data?.results) ? res.data!.results! : [];

  for (const axis of input.axisNames) {
    const want = axis.trim().toLowerCase();
    const match = results.find((p) => {
      const names = [p.name, p.display_name]
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.trim().toLowerCase());
      return names.includes(want) || names.some((n) => n.includes(want) || want.includes(n));
    });
    if (match?.property_id != null && Number.isFinite(Number(match.property_id))) {
      const scaleId =
        Array.isArray(match.scales) && match.scales[0]?.scale_id != null
          ? Number(match.scales[0].scale_id)
          : null;
      out.set(axis, { propertyId: Number(match.property_id), scaleId });
      continue;
    }
    const fallback = FALLBACK_PROPERTY_IDS[want];
    if (fallback != null) {
      out.set(axis, { propertyId: fallback, scaleId: null });
      continue;
    }
    // Stable synthetic id from name hash so PUT can still send property_name.
    let hash = 0;
    for (let i = 0; i < want.length; i += 1) hash = (hash * 31 + want.charCodeAt(i)) | 0;
    const synthetic = 900_000_000 + (Math.abs(hash) % 50_000_000);
    out.set(axis, { propertyId: synthetic, scaleId: null });
  }
  return out;
}

function inferVaryAxes(
  variants: Array<{ options: Record<string, string>; priceCents: number; sku: string | null; quantity: number }>,
  axisNames: string[]
): { priceAxes: string[]; quantityAxes: string[]; skuAxes: string[] } {
  const prices = new Set(variants.map((v) => v.priceCents));
  const qtys = new Set(variants.map((v) => v.quantity));
  const skus = new Set(variants.map((v) => (v.sku ?? "").trim()));
  return {
    priceAxes: prices.size > 1 ? [...axisNames] : [],
    quantityAxes: qtys.size > 1 ? [...axisNames] : [],
    skuAxes:
      [...skus].filter(Boolean).length > 1 || (skus.size > 1 && [...skus].some(Boolean))
        ? [...axisNames]
        : [],
  };
}

export function buildEtsyInventoryProductsPayload(input: {
  variants: EtsyStoreVariantRow[];
  inventoryTracking: string | null | undefined;
  axisNames: string[];
  propertyMap: Map<string, { propertyId: number; scaleId: number | null }>;
  readinessStateId: number | string;
}): {
  products: EtsyInventoryProductInput[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
  storeVariantIds: string[];
} {
  const enriched = input.variants.map((v) => {
    const options = parseStoreVariantOptions(v.options)!;
    return {
      id: v.id,
      options,
      priceCents: v.priceCents,
      sku: v.sku,
      quantity: sellableQtyForEtsyVariant(v, input.inventoryTracking),
    };
  });
  const { priceAxes, quantityAxes, skuAxes } = inferVaryAxes(enriched, input.axisNames);
  const propId = (axis: string) => input.propertyMap.get(axis)!.propertyId;

  const products: EtsyInventoryProductInput[] = enriched.map((v) => ({
    sku: (v.sku ?? "").trim(),
    property_values: input.axisNames.map((axis) => {
      const meta = input.propertyMap.get(axis)!;
      const value =
        Object.entries(v.options).find(
          ([k]) => k.trim().toLowerCase() === axis.trim().toLowerCase()
        )?.[1] ?? "";
      return {
        property_id: meta.propertyId,
        property_name: axis,
        values: [value],
        ...(meta.scaleId != null ? { scale_id: meta.scaleId } : {}),
      };
    }),
    offerings: [
      {
        price: v.priceCents / 100,
        quantity: Math.max(0, v.quantity),
        is_enabled: true,
        readiness_state_id: input.readinessStateId,
      },
    ],
  }));

  return {
    products,
    price_on_property: [...new Set(priceAxes.map(propId))],
    quantity_on_property: [...new Set(quantityAxes.map(propId))],
    sku_on_property: [...new Set(skuAxes.map(propId))],
    storeVariantIds: enriched.map((v) => v.id),
  };
}

export function optionsFromEtsyPropertyValues(
  propertyValues: EtsyRemoteInventoryProduct["property_values"]
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const pv of propertyValues ?? []) {
    const name = typeof pv.property_name === "string" ? pv.property_name.trim() : "";
    const values = Array.isArray(pv.values) ? pv.values : [];
    const value = values.map((v) => String(v)).filter(Boolean).join(" / ");
    if (name && value) options[name] = value;
  }
  return options;
}

/**
 * Correlate remote Etsy products to StoreVariants by option combination key.
 */
export function correlateEtsyProductsToStoreVariants(input: {
  requested: Array<{ storeVariantId: string; options: Record<string, string> }>;
  remote: EtsyRemoteInventoryProduct[];
}):
  | {
      ok: true;
      pairs: Array<{
        storeVariantId: string;
        etsyProductId: string;
        etsyOfferingId: string;
        propertyValuesJson: EtsyRemoteInventoryProduct["property_values"];
        remoteSku: string | null;
        remoteAvailable: number | null;
      }>;
    }
  | { ok: false; code: string; message: string } {
  if (input.requested.length !== input.remote.length) {
    return {
      ok: false,
      code: "VARIANT_COUNT_MISMATCH",
      message: `Requested ${input.requested.length} variants but Etsy returned ${input.remote.length} products`,
    };
  }
  const byCombo = new Map<string, EtsyRemoteInventoryProduct>();
  for (const product of input.remote) {
    const opts = optionsFromEtsyPropertyValues(product.property_values);
    byCombo.set(skuSelectionKey(opts), product);
  }
  const pairs: Array<{
    storeVariantId: string;
    etsyProductId: string;
    etsyOfferingId: string;
    propertyValuesJson: EtsyRemoteInventoryProduct["property_values"];
    remoteSku: string | null;
    remoteAvailable: number | null;
  }> = [];
  for (const req of input.requested) {
    const key = skuSelectionKey(req.options);
    const match = byCombo.get(key);
    if (!match) {
      return {
        ok: false,
        code: "OPTION_CORRELATION_FAILED",
        message: `No Etsy product for combination ${key}`,
      };
    }
    byCombo.delete(key);
    const productId = String(match.product_id ?? "").trim();
    const offering =
      (match.offerings ?? []).find((o) => o?.is_enabled !== false) ?? match.offerings?.[0];
    const offeringId = String(offering?.offering_id ?? "").trim();
    if (!/^\d+$/.test(productId) || !/^\d+$/.test(offeringId)) {
      return {
        ok: false,
        code: "INVENTORY_SHAPE",
        message: "Etsy product/offering ids missing after inventory PUT",
      };
    }
    pairs.push({
      storeVariantId: req.storeVariantId,
      etsyProductId: productId,
      etsyOfferingId: offeringId,
      propertyValuesJson: match.property_values,
      remoteSku: typeof match.sku === "string" ? match.sku : null,
      remoteAvailable:
        typeof offering?.quantity === "number" ? Math.max(0, Math.trunc(offering.quantity)) : null,
    });
  }
  return { ok: true, pairs };
}

/** Build a VariantMatrix-shaped vary check for etsyVariesByAllProperties consumers. */
export function storeVariantsToMatrixSketch(
  variants: EtsyStoreVariantRow[],
  inventoryTracking: string | null | undefined
): VariantMatrix | null {
  const axisMap = new Map<string, Set<string>>();
  const skus: VariantMatrix["skus"] = [];
  for (const v of variants) {
    const opts = parseStoreVariantOptions(v.options);
    if (!opts) return null;
    for (const [name, value] of Object.entries(opts)) {
      if (!axisMap.has(name)) axisMap.set(name, new Set());
      axisMap.get(name)!.add(value);
    }
    skus.push({
      options: opts,
      quantity: sellableQtyForEtsyVariant(v, inventoryTracking),
      priceCents: v.priceCents,
      sku: v.sku ?? undefined,
    });
  }
  return {
    axes: [...axisMap.entries()].map(([name, values]) => ({ name, values: [...values] })),
    skus,
  };
}
