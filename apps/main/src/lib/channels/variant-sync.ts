import { createHash } from "crypto";
import type { ChannelProvider } from "./types";
import {
  MAX_ETSY_AXES,
  MAX_ETSY_SKUS_ALL_PROPERTIES,
  MAX_SKU_ROWS_SHOPIFY,
  MAX_VARIANT_AXES,
  etsyVariesByAllProperties,
  fillMissingAlphanumericComboSkus,
  matrixToLegacyAxes,
  normalizeVariantMatrix,
  serializeVariantMatrix,
  skuSelectionKey,
  sumMatrixQuantities,
  validateVariantMatrixForSave,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";

export type InwVariantOption = {
  value: string;
  quantity: number;
  /** Channel SKU for this option (eBay variation Custom Label). */
  sku?: string;
};

export type InwVariantAxis = {
  name: string;
  options: InwVariantOption[];
};

function readOptionSku(opt: unknown): string | undefined {
  if (typeof opt !== "object" || opt == null) return undefined;
  const sku = (opt as { sku?: unknown }).sku;
  if (typeof sku !== "string") return undefined;
  const trimmed = sku.trim();
  return trimmed || undefined;
}

function isOptionWithQty(opt: unknown): opt is { value: string; quantity: number } {
  return (
    typeof opt === "object" &&
    opt != null &&
    "value" in opt &&
    typeof (opt as { value: unknown }).value === "string" &&
    "quantity" in opt &&
    typeof (opt as { quantity: unknown }).quantity === "number"
  );
}

function parseLegacyAxes(remoteVariants: unknown): InwVariantAxis[] | null {
  if (!remoteVariants || !Array.isArray(remoteVariants) || remoteVariants.length === 0) {
    return null;
  }

  const axes: InwVariantAxis[] = [];
  for (const row of remoteVariants as Record<string, unknown>[]) {
    const name = String(row.name ?? row.optionName ?? row.property_name ?? "Option").trim();
    if (!name) continue;

    const rawOpts = row.options ?? row.values ?? row.choices;
    if (!Array.isArray(rawOpts) || rawOpts.length === 0) continue;

    const options: InwVariantOption[] = [];
    for (const o of rawOpts) {
      if (isOptionWithQty(o)) {
        const sku = readOptionSku(o);
        options.push({
          value: String(o.value).trim(),
          quantity: Math.max(0, Math.round(o.quantity)),
          ...(sku ? { sku } : {}),
        });
      } else if (typeof o === "object" && o != null) {
        const obj = o as Record<string, unknown>;
        const value = String(obj.value ?? obj.label ?? obj.name ?? "").trim();
        if (!value) continue;
        const rawQty =
          typeof obj.quantity === "number"
            ? obj.quantity
            : typeof obj.quantity === "string" && obj.quantity.trim() !== ""
              ? Number(obj.quantity)
              : typeof obj.inventory_quantity === "number"
                ? obj.inventory_quantity
                : typeof obj.inventory_quantity === "string" && String(obj.inventory_quantity).trim() !== ""
                  ? Number(obj.inventory_quantity)
                  : NaN;
        const qty = Number.isFinite(rawQty) ? Math.max(0, Math.round(rawQty)) : 0;
        const sku = readOptionSku(obj);
        options.push({ value, quantity: qty, ...(sku ? { sku } : {}) });
      } else if (o != null) {
        options.push({ value: String(o).trim(), quantity: 0 });
      }
    }
    if (options.length > 0) axes.push({ name: name.slice(0, 80), options });
  }

  return axes.length > 0 ? axes : null;
}

/** Normalize any provider variant payload to INW per-option-quantity axes (derived from the matrix). */
export function normalizeVariantsFromProvider(
  _provider: ChannelProvider,
  remoteVariants: unknown
): InwVariantAxis[] | null {
  const matrix = normalizeVariantMatrix(remoteVariants);
  if (matrix && matrix.axes.length > 0) {
    return matrixToLegacyAxes(matrix);
  }
  return parseLegacyAxes(remoteVariants);
}

export function variantsToMatrix(remoteVariants: unknown): VariantMatrix | null {
  return normalizeVariantMatrix(remoteVariants);
}

export function matrixForStorage(
  remoteVariants: unknown,
  opts?: { itemId?: string; parentSku?: string | null }
): VariantMatrix | null {
  const matrix = normalizeVariantMatrix(remoteVariants);
  if (!matrix) return null;
  const filled = opts?.itemId
    ? fillMissingAlphanumericComboSkus(matrix, opts.itemId, opts.parentSku)
    : matrix;
  return serializeVariantMatrix(filled);
}

/**
 * True when applying `incoming` would drop option types or combinations INW already has
 * (e.g. Etsy Color-only inventory overwriting Size × Color).
 */
export function remoteVariantMatrixIsWeaker(existing: unknown, incoming: unknown): boolean {
  const inw = normalizeVariantMatrix(existing);
  if (!inw || inw.axes.length === 0) return false;
  const remote = normalizeVariantMatrix(incoming);
  if (!remote || remote.axes.length === 0) return true;
  const inwArity = Math.max(
    inw.axes.length,
    ...inw.skus.map((s) => Object.keys(s.options).length),
    0
  );
  const remoteArity = Math.max(
    remote.axes.length,
    ...remote.skus.map((s) => Object.keys(s.options).length),
    0
  );
  if (remoteArity < inwArity) return true;
  if (remote.axes.length < inw.axes.length) return true;
  return false;
}

/** Persist the combo matrix on import — never collapse to per-value totals. */
export function variantsPayloadForImport(listing: {
  variants?: unknown;
  variantsKnown?: boolean;
}): VariantMatrix | null {
  if (listing.variantsKnown === false) return null;
  return matrixForStorage(listing.variants);
}

/** Stable fingerprint for baseline meta sync. */
export function variantsFingerprint(variants: unknown): string {
  const matrix = normalizeVariantMatrix(variants);
  if (matrix && matrix.axes.length > 0) {
    const compact = {
      a: matrix.axes.map((ax) => ({ n: ax.name, v: [...ax.values].sort((x, y) => x.localeCompare(y)) })),
      s: matrix.skus
        .map((sku) => ({
          o: sku.options,
          q: sku.quantity,
          p: sku.priceCents ?? null,
          k: sku.sku ?? null,
        }))
        .sort((x, y) => JSON.stringify(x.o).localeCompare(JSON.stringify(y.o))),
    };
    return createHash("sha1").update(JSON.stringify(compact)).digest("hex");
  }
  const normalized = parseLegacyAxes(variants);
  if (!normalized) return "";
  const compact = normalized.map((a) => ({
    n: a.name,
    o: a.options
      .map((opt) => ({ v: opt.value, q: opt.quantity }))
      .sort((x, y) => x.v.localeCompare(y.v)),
  }));
  return createHash("sha1").update(JSON.stringify(compact)).digest("hex");
}

/** Sum SKU (or legacy option) quantities. */
export function sumVariantQuantities(variants: InwVariantAxis[] | VariantMatrix | null | unknown): number {
  const matrix = normalizeVariantMatrix(variants);
  if (matrix) return sumMatrixQuantities(matrix);
  if (!variants || !Array.isArray(variants)) return 0;
  let sum = 0;
  for (const axis of variants as InwVariantAxis[]) {
    if (!axis?.options) continue;
    for (const o of axis.options) sum += Math.max(0, o.quantity ?? 0);
  }
  return sum;
}

/** Match a sale's variant map to INW option names. */
export function matchSaleToVariantOption(
  saleVariant: Record<string, string> | null | undefined,
  variants: unknown
): Record<string, string> | null {
  if (!saleVariant || typeof saleVariant !== "object") return null;
  const matrix = normalizeVariantMatrix(variants);
  const axes = matrix?.axes ?? parseLegacyAxes(variants) ?? [];
  if (axes.length === 0) return null;

  const out: Record<string, string> = {};
  for (const axis of axes) {
    const axisName = "name" in axis ? axis.name : "";
    for (const key of Object.keys(saleVariant)) {
      if (key.toLowerCase() !== axisName.toLowerCase()) continue;
      const val = saleVariant[key]?.trim();
      if (val) out[axisName] = val;
    }
  }

  if (Object.keys(out).length === axes.length) return out;

  const joined = Object.values(saleVariant)
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" / ");
  if (joined && matrix) {
    const slashParts = joined.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    if (slashParts.length === axes.length) {
      const guessed: Record<string, string> = {};
      axes.forEach((axis, i) => {
        guessed[axis.name] = slashParts[i]!;
      });
      const hit = matrix.skus.find((s) => skuSelectionKey(s.options) === skuSelectionKey(guessed));
      if (hit) return hit.options;
    }
    const byValues = matchMatrixByOptionValues(matrix, Object.values(saleVariant));
    if (byValues) return byValues;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function matchMatrixByOptionValues(
  matrix: VariantMatrix,
  values: string[]
): Record<string, string> | null {
  const want = values.map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (want.length === 0) return null;
  const hit = matrix.skus.find((sku) => {
    const have = Object.values(sku.options).map((v) => v.trim().toLowerCase());
    return want.every((w) => have.includes(w)) && have.length === want.length;
  });
  return hit?.options ?? null;
}

/** Per-channel variant limits. */
export function validateVariantLimits(
  provider: ChannelProvider,
  variants: InwVariantAxis[] | null | unknown
): string | null {
  const matrix = normalizeVariantMatrix(variants);
  const axes = matrix?.axes ?? (Array.isArray(variants) ? (variants as InwVariantAxis[]) : null);
  if (!axes || axes.length === 0) return null;
  if (provider === "shopify" && axes.length > 3) {
    return "Shopify supports at most 3 product options.";
  }
  if (provider === "etsy" && axes.length > MAX_ETSY_AXES) {
    return `Etsy supports at most ${MAX_ETSY_AXES} variation properties. Remove an option type or unsync Etsy.`;
  }
  const skuCount =
    matrix?.skus.length ??
    axes.reduce((n, a) => n * Math.max(1, "values" in a ? a.values.length : a.options?.length ?? 1), 1);
  if (provider === "shopify" && skuCount > MAX_SKU_ROWS_SHOPIFY) {
    return "Shopify supports at most 100 variants per product.";
  }
  if (provider === "etsy" && matrix && etsyVariesByAllProperties(matrix) && skuCount > MAX_ETSY_SKUS_ALL_PROPERTIES) {
    return `Etsy supports at most ${MAX_ETSY_SKUS_ALL_PROPERTIES} combinations when price, quantity, or SKU varies on all option types.`;
  }
  if (provider === "ebay" && skuCount > 250) {
    return "eBay supports at most 250 variations per listing.";
  }
  for (const axis of axes) {
    const n = "values" in axis ? axis.values.length : axis.options?.length ?? 0;
    const name = axis.name;
    if (n === 0) return `Option "${name}" has no values.`;
  }
  return null;
}

/** Validate INW canonical variants on seller save (multi-axis matrix). */
export function validateInwVariantsForSave(
  variants: unknown,
  opts?: { linkedProviders?: string[] | null }
): string | null {
  if (variants == null) return null;
  if (Array.isArray(variants) && variants.length === 0) return null;
  return validateVariantMatrixForSave(variants, opts);
}

/** Build provider-specific variant payload stub — adapters extend with API details. */
export function buildProviderVariants(
  provider: ChannelProvider,
  inwVariants: InwVariantAxis[] | null
): unknown {
  if (!inwVariants || inwVariants.length === 0) return null;
  return { provider, axes: inwVariants };
}

export { MAX_VARIANT_AXES };
