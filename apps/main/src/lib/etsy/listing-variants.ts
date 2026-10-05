/**
 * INW StoreVariant.options → Etsy listing inventory products[] (Size×Color matrix).
 * Mirrors Shopify multi-variant export correlation, via Etsy PUT inventory.
 */
import { etsyCentsFromMoney, trackedAvailable } from "database";
import {
  MAX_ETSY_AXES,
  MAX_ETSY_SKUS_ALL_PROPERTIES,
  optionValuesKey,
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
  // Do not use Size=100 — Etsy rejects it as deprecated on inventory PUT.
  color: 200,
  colour: 200,
  material: 507,
  style: 46803063641,
  pattern: 46803063659,
};

/**
 * Free-form custom variation slots (Etsy Open API).
 * Prefer these over deprecated legacy Size (100) when taxonomy has no usable property.
 */
const CUSTOM_VARIATION_PROPERTY_IDS = [513, 514, 516] as const;
const CUSTOM_VARIATION_PROPERTY_ID_SET = new Set<number>(CUSTOM_VARIATION_PROPERTY_IDS);

/** Required on inventory reads/writes that use a third variation axis. */
export const ETSY_INVENTORY_QUERY = { max_variations_supported: 3 } as const;

/** Property ids Etsy currently rejects on inventory writes. */
const DEPRECATED_VARIATION_PROPERTY_IDS = new Set<number>([100]);

export function isDeprecatedEtsyVariationPropertyId(propertyId: number): boolean {
  return DEPRECATED_VARIATION_PROPERTY_IDS.has(propertyId);
}

/**
 * Pick a usable property id for an axis: taxonomy match (if not deprecated),
 * named fallback (if not deprecated), else next custom variation slot (513/514/516).
 */
export function pickEtsyVariationPropertyId(input: {
  axisName: string;
  taxonomyPropertyId?: number | null;
  taxonomyScaleId?: number | null;
  usedPropertyIds: Set<number>;
}): { propertyId: number; scaleId: number | null; source: "taxonomy" | "fallback" | "custom" } {
  const want = input.axisName.trim().toLowerCase();
  const taxonomyId =
    input.taxonomyPropertyId != null && Number.isFinite(Number(input.taxonomyPropertyId))
      ? Number(input.taxonomyPropertyId)
      : null;
  if (
    taxonomyId != null &&
    !isDeprecatedEtsyVariationPropertyId(taxonomyId) &&
    !input.usedPropertyIds.has(taxonomyId)
  ) {
    return {
      propertyId: taxonomyId,
      scaleId: input.taxonomyScaleId ?? null,
      source: "taxonomy",
    };
  }

  const fallback = FALLBACK_PROPERTY_IDS[want];
  if (
    fallback != null &&
    !isDeprecatedEtsyVariationPropertyId(fallback) &&
    !input.usedPropertyIds.has(fallback)
  ) {
    return { propertyId: fallback, scaleId: null, source: "fallback" };
  }

  for (const customId of CUSTOM_VARIATION_PROPERTY_IDS) {
    if (!input.usedPropertyIds.has(customId)) {
      return { propertyId: customId, scaleId: null, source: "custom" };
    }
  }

  // Last resort: stable synthetic (should be rare; Etsy allows ≤3 custom axes).
  let hash = 0;
  for (let i = 0; i < want.length; i += 1) hash = (hash * 31 + want.charCodeAt(i)) | 0;
  const synthetic = 900_000_000 + (Math.abs(hash) % 50_000_000);
  return { propertyId: synthetic, scaleId: null, source: "custom" };
}

type InventoryPropertyValueLike = {
  property_id?: number;
  property_name?: string;
  values?: string[];
  value_ids?: number[];
  scale_id?: number | null;
};

/** True when any product still carries a deprecated variation property (e.g. Size=100). */
export function inventoryHasDeprecatedEtsyProperties(
  products: Array<{ property_values?: InventoryPropertyValueLike[] | null }>
): boolean {
  for (const product of products) {
    for (const pv of product.property_values ?? []) {
      const id = Number(pv.property_id);
      if (Number.isFinite(id) && isDeprecatedEtsyVariationPropertyId(id)) return true;
    }
  }
  return false;
}

/**
 * Rewrite deprecated property ids (notably Size=100) before inventory PUT.
 * Keeps option names/values; clears stale value_ids/scales tied to the old property.
 */
export function sanitizeDeprecatedEtsyInventoryProperties<
  T extends { property_values?: InventoryPropertyValueLike[] | null },
>(input: {
  products: T[];
  price_on_property?: number[] | null;
  quantity_on_property?: number[] | null;
  sku_on_property?: number[] | null;
}): {
  products: T[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
  rewritten: boolean;
} {
  const idRemap = new Map<number, number>();
  const used = new Set<number>();

  for (const product of input.products) {
    for (const pv of product.property_values ?? []) {
      const id = Number(pv.property_id);
      if (Number.isFinite(id) && !isDeprecatedEtsyVariationPropertyId(id)) {
        used.add(id);
      }
    }
  }

  function mapId(oldId: number, axisName: string): number {
    const existing = idRemap.get(oldId);
    if (existing != null) return existing;
    const picked = pickEtsyVariationPropertyId({
      axisName,
      usedPropertyIds: used,
    });
    idRemap.set(oldId, picked.propertyId);
    used.add(picked.propertyId);
    return picked.propertyId;
  }

  let rewritten = false;
  const products = input.products.map((product) => {
    const propertyValues = product.property_values;
    if (!Array.isArray(propertyValues) || propertyValues.length === 0) return product;
    let touched = false;
    const nextValues = propertyValues.map((pv) => {
      const id = Number(pv.property_id);
      if (!Number.isFinite(id) || !isDeprecatedEtsyVariationPropertyId(id)) return pv;
      touched = true;
      rewritten = true;
      const nextId = mapId(id, String(pv.property_name ?? "Size"));
      return {
        ...pv,
        property_id: nextId,
        value_ids: [] as number[],
        scale_id: null,
      };
    });
    return touched ? { ...product, property_values: nextValues } : product;
  });

  const remapList = (ids: number[] | null | undefined): number[] =>
    (ids ?? []).map((id) => {
      const n = Number(id);
      if (!Number.isFinite(n) || !isDeprecatedEtsyVariationPropertyId(n)) return n;
      rewritten = true;
      return mapId(n, "Size");
    });

  return {
    products,
    price_on_property: remapList(input.price_on_property),
    quantity_on_property: remapList(input.quantity_on_property),
    sku_on_property: remapList(input.sku_on_property),
    rewritten,
  };
}

type InventoryOfferingLike = {
  offering_id?: unknown;
  is_deleted?: boolean;
  price?: unknown;
  quantity?: number;
  is_enabled?: boolean;
  readiness_state_id?: number | string;
};

type InventoryProductLike = {
  sku?: string | null;
  product_id?: unknown;
  is_deleted?: boolean;
  property_values?: InventoryPropertyValueLike[] | null | unknown;
  offerings?: InventoryOfferingLike[] | null;
};

export type EtsyInventoryPutProduct = {
  sku: string;
  property_values: Array<{
    property_id: number;
    property_name: string;
    values: string[];
    value_ids: number[];
    scale_id?: number;
  }>;
  offerings: Array<{
    price: number;
    quantity: number;
    is_enabled: boolean;
    readiness_state_id?: number | string;
  }>;
};

export type EtsyInventoryPutBody = {
  products: EtsyInventoryPutProduct[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
};

function offeringPriceDollars(price: unknown): number {
  if (price && typeof price === "object") {
    const money = price as { amount?: number; divisor?: number };
    const cents = etsyCentsFromMoney({ amount: money.amount, divisor: money.divisor });
    if (Number.isFinite(cents) && cents > 0) return Math.max(0.2, cents / 100);
  }
  if (typeof price === "number" && Number.isFinite(price) && price > 0) {
    return Math.max(0.2, price);
  }
  if (typeof price === "string") {
    const cents = etsyCentsFromMoney({ price });
    if (Number.isFinite(cents) && cents > 0) return Math.max(0.2, cents / 100);
  }
  return 0.2;
}

function cleanPropertyValue(pv: InventoryPropertyValueLike): EtsyInventoryPutProduct["property_values"][number] | null {
  const propertyId = Number(pv.property_id);
  if (!Number.isFinite(propertyId) || isDeprecatedEtsyVariationPropertyId(propertyId)) return null;
  const values = (pv.values ?? []).map((value) => String(value)).filter((value) => value.length > 0);
  if (values.length === 0) return null;
  const name = String(pv.property_name ?? "").trim() || "Variation";
  const clearValueIds =
    CUSTOM_VARIATION_PROPERTY_ID_SET.has(propertyId) || !Array.isArray(pv.value_ids);
  const valueIds = clearValueIds
    ? []
    : pv.value_ids!.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  const scaleId = typeof pv.scale_id === "number" ? pv.scale_id : Number.NaN;
  return {
    property_id: propertyId,
    property_name: name,
    values,
    value_ids: valueIds,
    ...(Number.isFinite(scaleId) ? { scale_id: scaleId } : {}),
  };
}

/**
 * Etsy updateListingInventory body. Full products[] replace.
 * Strips GET-only fields (product_id, offering_id, money objects, is_deleted)
 * and rewrites deprecated property ids before the request is sent.
 */
export function toEtsyInventoryPutBody(input: {
  products: InventoryProductLike[];
  price_on_property?: number[] | null;
  quantity_on_property?: number[] | null;
  sku_on_property?: number[] | null;
}): EtsyInventoryPutBody {
  const normalizedProducts = input.products.map((product) => ({
    ...product,
    property_values: Array.isArray(product.property_values)
      ? (product.property_values as InventoryPropertyValueLike[])
      : null,
  }));
  const sanitized = sanitizeDeprecatedEtsyInventoryProperties({
    products: normalizedProducts,
    price_on_property: input.price_on_property,
    quantity_on_property: input.quantity_on_property,
    sku_on_property: input.sku_on_property,
  });

  const products: EtsyInventoryPutProduct[] = [];
  for (const product of sanitized.products) {
    if (product.is_deleted) continue;
    const offerings = (product.offerings ?? [])
      .filter((offering) => offering?.is_deleted !== true)
      .map((offering) => {
        const readiness = offering.readiness_state_id;
        return {
          price: offeringPriceDollars(offering.price),
          quantity:
            typeof offering.quantity === "number" && Number.isFinite(offering.quantity)
              ? Math.max(0, Math.trunc(offering.quantity))
              : 0,
          is_enabled: offering.is_enabled !== false,
          ...(readiness != null && readiness !== "" ? { readiness_state_id: readiness } : {}),
        };
      });
    if (offerings.length === 0) continue;
    products.push({
      sku: String(product.sku ?? "").trim(),
      property_values: (product.property_values ?? [])
        .map((pv) => cleanPropertyValue(pv))
        .filter((pv): pv is EtsyInventoryPutProduct["property_values"][number] => pv != null),
      offerings,
    });
  }

  // Multi-product variation listings must keep price/qty on every axis.
  // Echoing empty *_on_property from a prior GET collapses Shop Manager to one
  // listing-level price/qty while the live page still shows the option menus.
  const axisPropertyIds = [
    ...new Set(
      products.flatMap((product) => product.property_values.map((pv) => pv.property_id)).filter((id) => Number.isFinite(id))
    ),
  ];
  const keepPerCombination = products.length > 1 && axisPropertyIds.length > 0;
  return {
    products,
    price_on_property:
      keepPerCombination && sanitized.price_on_property.length === 0
        ? axisPropertyIds
        : sanitized.price_on_property,
    quantity_on_property:
      keepPerCombination && sanitized.quantity_on_property.length === 0
        ? axisPropertyIds
        : sanitized.quantity_on_property,
    sku_on_property: sanitized.sku_on_property,
  };
}

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
  const valuesByAxis = new Map<string, Set<string>>();
  for (const axis of axisNames) valuesByAxis.set(axis, new Set());
  for (const v of variants) {
    const opts = parseStoreVariantOptions(v.options)!;
    for (const [name, value] of Object.entries(opts)) {
      const axis = [...axisNames].find((candidate) => candidate.toLowerCase() === name.toLowerCase());
      if (axis) valuesByAxis.get(axis)!.add(value.trim().toLowerCase());
    }
  }
  let expected = 1;
  for (const values of valuesByAxis.values()) {
    if (values.size < 1) {
      return { ok: false, message: "Etsy export is missing option values" };
    }
    expected *= values.size;
  }
  if (variants.length !== expected) {
    const label = [...axisNames].sort((a, b) => a.localeCompare(b)).join(", ");
    return {
      ok: false,
      message: `Etsy needs every combination of ${label}. Found ${variants.length} of ${expected}. Turn on each row, or remove the unused option value.`,
    };
  }
  return { ok: true, multi: true, axisNames: [...axisNames] };
}

function normalizeVariationName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function variationStem(value: string): string {
  const normalized = normalizeVariationName(value);
  return normalized.endsWith("s") && normalized.length > 3 ? normalized.slice(0, -1) : normalized;
}

/**
 * Bind an INW axis to one taxonomy property.
 * Exact name first, then a simple plural (Material/Materials).
 * Substring matches are rejected so "Primary color" cannot take "Color"
 * and "Size" cannot take a shorter property.
 */
export function matchEtsyTaxonomyProperty<
  T extends { property_id?: number; name?: string; display_name?: string },
>(axisName: string, properties: T[], usedPropertyIds: ReadonlySet<number>): T | null {
  const want = normalizeVariationName(axisName);
  const wantStem = variationStem(want);
  const available = properties.filter((property) => {
    const id = Number(property.property_id);
    return Number.isFinite(id) && !usedPropertyIds.has(id) && !isDeprecatedEtsyVariationPropertyId(id);
  });
  const labelsOf = (property: T) =>
    [property.name, property.display_name]
      .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
      .map(normalizeVariationName);
  const exact = available.find((property) => labelsOf(property).includes(want));
  if (exact) return exact;
  return (
    available.find((property) => labelsOf(property).some((label) => variationStem(label) === wantStem)) ??
    null
  );
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
  const usedPropertyIds = new Set<number>();
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
    const match = matchEtsyTaxonomyProperty(axis, results, usedPropertyIds);
    const taxonomyPropertyId =
      match?.property_id != null && Number.isFinite(Number(match.property_id))
        ? Number(match.property_id)
        : null;
    const taxonomyScaleId =
      Array.isArray(match?.scales) && match!.scales![0]?.scale_id != null
        ? Number(match!.scales![0]!.scale_id)
        : null;

    const picked = pickEtsyVariationPropertyId({
      axisName: axis,
      taxonomyPropertyId,
      taxonomyScaleId,
      usedPropertyIds,
    });
    usedPropertyIds.add(picked.propertyId);
    out.set(axis, { propertyId: picked.propertyId, scaleId: picked.scaleId });
  }
  return out;
}

function inferVaryAxes(
  variants: Array<{ options: Record<string, string>; priceCents: number; sku: string | null; quantity: number }>,
  axisNames: string[]
): { priceAxes: string[]; quantityAxes: string[]; skuAxes: string[] } {
  const prices = new Set(variants.map((v) => v.priceCents));
  const skus = new Set(variants.map((v) => (v.sku ?? "").trim()));
  // A multi-variant listing always keeps price and quantity on every axis.
  // Empty *_on_property arrays make Etsy store one listing-level price and
  // quantity and drop the per-combination grid, even when products still
  // carry property values. 0 / 1 / all still holds: both fields are "all".
  const perCombination = variants.length > 1 && axisNames.length > 0;
  return {
    priceAxes: perCombination || prices.size > 1 ? [...axisNames] : [],
    quantityAxes: perCombination ? [...axisNames] : [],
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

function propertyValuesForStorage(
  propertyValues: EtsyRemoteInventoryProduct["property_values"]
): EtsyRemoteInventoryProduct["property_values"] {
  const sanitized = sanitizeDeprecatedEtsyInventoryProperties({
    products: [{ property_values: propertyValues ?? [] }],
  });
  return sanitized.products[0]?.property_values ?? propertyValues;
}

function uniqueProductIndex(
  products: EtsyRemoteInventoryProduct[],
  keyFor: (product: EtsyRemoteInventoryProduct) => string
): Map<string, EtsyRemoteInventoryProduct> {
  const counts = new Map<string, number>();
  for (const product of products) {
    const key = keyFor(product);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const index = new Map<string, EtsyRemoteInventoryProduct>();
  for (const product of products) {
    const key = keyFor(product);
    if (!key || counts.get(key) !== 1) continue;
    index.set(key, product);
  }
  return index;
}

/**
 * Correlate remote Etsy products to StoreVariants by option combination key.
 * Name+value first; unique value-set when Etsy renames axes but keeps the values.
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
  const byName = uniqueProductIndex(input.remote, (product) =>
    skuSelectionKey(optionsFromEtsyPropertyValues(product.property_values))
  );
  const byValues = uniqueProductIndex(input.remote, (product) =>
    optionValuesKey(optionsFromEtsyPropertyValues(product.property_values))
  );
  const used = new Set<EtsyRemoteInventoryProduct>();
  const pairs: Array<{
    storeVariantId: string;
    etsyProductId: string;
    etsyOfferingId: string;
    propertyValuesJson: EtsyRemoteInventoryProduct["property_values"];
    remoteSku: string | null;
    remoteAvailable: number | null;
  }> = [];
  for (const req of input.requested) {
    const nameKey = skuSelectionKey(req.options);
    const valueKey = optionValuesKey(req.options);
    const named = byName.get(nameKey);
    const valued = valueKey ? byValues.get(valueKey) : undefined;
    const match =
      named && !used.has(named) ? named : valued && !used.has(valued) ? valued : undefined;
    if (!match) {
      return {
        ok: false,
        code: "OPTION_CORRELATION_FAILED",
        message: `No Etsy product for combination ${nameKey}`,
      };
    }
    used.add(match);
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
      propertyValuesJson: propertyValuesForStorage(match.property_values),
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
