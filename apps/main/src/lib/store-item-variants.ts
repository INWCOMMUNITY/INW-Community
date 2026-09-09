/**
 * Helpers for store item variants with per-option / per-combination quantities.
 * - Legacy: variants[].options = string[] → inventory uses storeItem.quantity.
 * - Legacy: variants[].options = { value, quantity }[] → inventory per option (single axis).
 * - Matrix: { axes, skus } → inventory per combination (Size × Color).
 * Selected variant from cart/checkout: { [variantName]: optionValue } e.g. { Size: "Medium", Color: "Navy" }.
 */

import { listingDisplayPhotos } from "@/lib/listing-display-photo";
import {
  allMatrixAxesSelected,
  decrementMatrixSku,
  findSkuRow,
  incrementMatrixSku,
  isMadeToOrderTracking,
  matrixHasSkuRows,
  MTO_PURCHASE_CAP,
  normalizeVariantMatrix,
  sumMatrixQuantities,
  type VariantMatrix,
} from "@/lib/listing-variant-matrix";

export type VariantOptionWithQty = { value: string; quantity: number };
export type VariantWithOptionQuantities = { name: string; options: VariantOptionWithQty[] };
export type VariantLegacy = { name?: string; options?: string[] };
export type VariantsJson = VariantWithOptionQuantities[] | VariantLegacy[] | VariantMatrix | null;

function isOptionWithQty(opt: unknown): opt is VariantOptionWithQty {
  return (
    typeof opt === "object" &&
    opt != null &&
    "value" in opt &&
    typeof (opt as VariantOptionWithQty).value === "string" &&
    "quantity" in opt &&
    typeof (opt as VariantOptionWithQty).quantity === "number"
  );
}

function isVariantWithOptionQuantities(v: unknown): v is VariantWithOptionQuantities {
  if (typeof v !== "object" || v == null || !Array.isArray((v as VariantWithOptionQuantities).options))
    return false;
  const opts = (v as VariantWithOptionQuantities).options;
  return opts.length > 0 && isOptionWithQty(opts[0]);
}

function isMatrixJson(variants: unknown): boolean {
  return Boolean(
    variants &&
      typeof variants === "object" &&
      !Array.isArray(variants) &&
      Array.isArray((variants as { axes?: unknown }).axes)
  );
}

/** True if this item uses per-option or per-combination quantities. */
export function hasOptionQuantities(variants: unknown): boolean {
  if (isMatrixJson(variants)) {
    return matrixHasSkuRows(normalizeVariantMatrix(variants));
  }
  if (!variants || !Array.isArray(variants)) return false;
  return (variants as unknown[]).some(isVariantWithOptionQuantities);
}

/**
 * Items with per-option stock sync inventory via updateListing (option rows), not aggregate
 * syncInventoryToChannels — which would overwrite each size with the total.
 */
export function usesPerOptionInventorySync(variants: unknown): boolean {
  return hasOptionQuantities(variants);
}

/**
 * True when checkout sent a real variant map (e.g. { Size: "M" }). Empty objects are treated as missing
 * so we don't silently fall through to aggregate-only decrements on option-quantity listings.
 */
export function hasMeaningfulVariantSelection(variant: unknown): boolean {
  if (variant == null || typeof variant !== "object" || Array.isArray(variant)) return false;
  const o = variant as Record<string, unknown>;
  return Object.keys(o).some((k) => {
    const v = o[k];
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    return String(v).trim().length > 0;
  });
}

function asSelection(variant: unknown): Record<string, string> | null {
  if (!hasMeaningfulVariantSelection(variant)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(variant as Record<string, unknown>)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * When we can't match `selectedVariant` to an option row, but the listing has exactly one variant axis
 * with per-option quantities, remove `by` units from options (largest bucket first). Returns null if
 * the shape isn't unambiguous (multiple axes) or stock is insufficient.
 */
export function decrementSingleAxisOptionQuantities(
  variants: unknown,
  by: number
): { variants: VariantsJson; quantityDelta: number } | null {
  if (by < 1) return null;
  const matrix = isMatrixJson(variants) ? normalizeVariantMatrix(variants) : null;
  if (matrix) {
    if (matrix.axes.length !== 1) return null;
    let remaining = by;
    const next = JSON.parse(JSON.stringify(matrix)) as VariantMatrix;
    while (remaining > 0) {
      const withStock = next.skus.filter((s) => s.quantity > 0);
      if (withStock.length === 0) return null;
      const pick = withStock.reduce((a, b) => (a.quantity >= b.quantity ? a : b));
      pick.quantity -= 1;
      remaining -= 1;
    }
    return { variants: next, quantityDelta: by };
  }
  if (!variants || !Array.isArray(variants) || by < 1) return null;
  const next = JSON.parse(JSON.stringify(variants)) as VariantWithOptionQuantities[];
  const dims = next.filter(
    (v) => Array.isArray(v.options) && v.options.length > 0 && isOptionWithQty(v.options[0])
  );
  if (dims.length !== 1) return null;
  const opts = dims[0].options as VariantOptionWithQty[];
  let remaining = by;
  while (remaining > 0) {
    const withStock = opts.filter((o) => o.quantity > 0);
    if (withStock.length === 0) return null;
    const pick = withStock.reduce((a, b) => (a.quantity >= b.quantity ? a : b));
    pick.quantity -= 1;
    remaining -= 1;
  }
  return { variants: next, quantityDelta: by };
}

type QtyItem = { variants?: unknown; quantity: number; inventoryTracking?: string | null };

/** Get available quantity for the item. Matrix / option qty uses the selected combination. */
export function getAvailableQuantity(
  storeItem: QtyItem,
  selectedVariant?: unknown
): number {
  if (isMadeToOrderTracking(storeItem.inventoryTracking)) {
    return MTO_PURCHASE_CAP;
  }

  if (isMatrixJson(storeItem.variants)) {
    const matrix = normalizeVariantMatrix(storeItem.variants);
    if (!matrix || matrix.skus.length === 0) return Math.max(0, storeItem.quantity);
    const sel = asSelection(selectedVariant);
    if (!sel) return 0;
    const row = findSkuRow(matrix, sel);
    return row ? Math.max(0, row.quantity) : 0;
  }

  if (!hasOptionQuantities(storeItem.variants)) {
    return Math.max(0, storeItem.quantity);
  }

  if (!selectedVariant || typeof selectedVariant !== "object" || Array.isArray(selectedVariant)) {
    return 0;
  }

  const sel = selectedVariant as Record<string, string>;
  const variants = storeItem.variants as VariantsJson;
  if (!variants || !Array.isArray(variants)) return 0;

  const qtyAxes = (variants as unknown[]).filter(isVariantWithOptionQuantities) as VariantWithOptionQuantities[];
  if (qtyAxes.length > 1) {
    const matrix = normalizeVariantMatrix(variants);
    if (matrix) {
      const row = findSkuRow(matrix, sel);
      return row ? Math.max(0, row.quantity) : 0;
    }
  }

  for (const v of variants as { name?: string; options?: unknown[] }[]) {
    const name = v.name?.trim();
    if (!name || sel[name] == null || !String(sel[name]).trim()) continue;
    const opts = v.options;
    if (!Array.isArray(opts) || !isOptionWithQty(opts[0])) continue;
    const optionValue = String(sel[name]).trim().toLowerCase();
    const opt = (opts as VariantOptionWithQty[]).find(
      (o) => String(o.value).trim().toLowerCase() === optionValue
    );
    return opt ? Math.max(0, opt.quantity) : 0;
  }

  return 0;
}

export function getSkuPriceCents(
  storeItem: { variants?: unknown; priceCents: number },
  selectedVariant?: unknown
): number {
  const matrix = normalizeVariantMatrix(storeItem.variants);
  if (!matrix) return storeItem.priceCents;
  const sel = asSelection(selectedVariant);
  if (!sel) return storeItem.priceCents;
  const row = findSkuRow(matrix, sel);
  if (row?.priceCents != null && row.priceCents > 0) return row.priceCents;
  return storeItem.priceCents;
}

export function getSkuPhotos(
  storeItem: { variants?: unknown; photos: string[] },
  selectedVariant?: unknown
): string[] {
  const matrix = normalizeVariantMatrix(storeItem.variants);
  if (!matrix) return storeItem.photos ?? [];
  const sel = asSelection(selectedVariant);
  if (!sel) return storeItem.photos ?? [];
  const row = findSkuRow(matrix, sel);
  if (row?.photos && row.photos.length > 0) return row.photos;
  return storeItem.photos ?? [];
}

/** After a purchase: return updated variants JSON with option quantity decremented. */
export function decrementOptionQuantity(
  variants: unknown,
  selectedVariant: unknown,
  by: number
): { variants: VariantsJson; quantityDelta: number } | null {
  if (by < 1) return null;
  const sel = asSelection(selectedVariant);
  if (!sel) return null;

  if (isMatrixJson(variants)) {
    const matrix = normalizeVariantMatrix(variants);
    if (!matrix) return null;
    const next = decrementMatrixSku(matrix, sel, by);
    if (!next) return null;
    return { variants: next, quantityDelta: by };
  }

  if (!variants || !Array.isArray(variants) || typeof selectedVariant !== "object") return null;

  const qtyAxes = (variants as unknown[]).filter(isVariantWithOptionQuantities);
  if (qtyAxes.length > 1) {
    const matrix = normalizeVariantMatrix(variants);
    if (!matrix) return null;
    const next = decrementMatrixSku(matrix, sel, by);
    if (!next) return null;
    return { variants: next, quantityDelta: by };
  }

  const next = JSON.parse(JSON.stringify(variants)) as VariantWithOptionQuantities[];
  for (let i = 0; i < next.length; i++) {
    const v = next[i];
    if (!v.options || !Array.isArray(v.options)) continue;
    if (!isOptionWithQty(v.options[0])) continue;
    const name = v.name?.trim();
    if (!name || sel[name] == null) continue;
    const optionValue = String(sel[name]).trim().toLowerCase();
    const opt = (v.options as VariantOptionWithQty[]).find(
      (o) => String(o.value).trim().toLowerCase() === optionValue
    );
    if (opt) {
      if (opt.quantity < by) return null;
      opt.quantity = Math.max(0, opt.quantity - by);
      return { variants: next, quantityDelta: by };
    }
  }
  return null;
}

/** Restore inventory (refund/cancel): increment option quantity. */
export function incrementOptionQuantity(
  variants: unknown,
  selectedVariant: unknown,
  by: number
): { variants: VariantsJson; quantityDelta: number } | null {
  if (by < 1) return null;
  const sel = asSelection(selectedVariant);
  if (!sel) return null;

  if (isMatrixJson(variants)) {
    const matrix = normalizeVariantMatrix(variants);
    if (!matrix) return null;
    const next = incrementMatrixSku(matrix, sel, by);
    if (!next) return null;
    return { variants: next, quantityDelta: by };
  }

  if (!variants || !Array.isArray(variants) || typeof selectedVariant !== "object") return null;

  const qtyAxes = (variants as unknown[]).filter(isVariantWithOptionQuantities);
  if (qtyAxes.length > 1) {
    const matrix = normalizeVariantMatrix(variants);
    if (!matrix) return null;
    const next = incrementMatrixSku(matrix, sel, by);
    if (!next) return null;
    return { variants: next, quantityDelta: by };
  }

  const next = JSON.parse(JSON.stringify(variants)) as VariantWithOptionQuantities[];
  for (let i = 0; i < next.length; i++) {
    const v = next[i];
    if (!v.options || !Array.isArray(v.options)) continue;
    if (!isOptionWithQty(v.options[0])) continue;
    const name = v.name?.trim();
    if (!name || sel[name] == null) continue;
    const optionValue = String(sel[name]).trim().toLowerCase();
    const opt = (v.options as VariantOptionWithQty[]).find(
      (o) => String(o.value).trim().toLowerCase() === optionValue
    );
    if (opt) {
      opt.quantity = opt.quantity + by;
      return { variants: next, quantityDelta: by };
    }
  }
  return null;
}

/** True when the listing should be treated as sold out (DB row or option stock exhausted). */
export function shouldMarkStoreItemSoldOut(item: {
  quantity: number;
  variants: unknown;
  inventoryTracking?: string | null;
}): boolean {
  if (isMadeToOrderTracking(item.inventoryTracking)) return false;
  if (item.quantity <= 0) return true;
  if (hasOptionQuantities(item.variants) && sumOptionQuantities(item.variants) <= 0) return true;
  return false;
}

/** Public storefront / feed: item is buyable. */
export function isStoreItemPubliclyPurchasable(item: {
  status: string;
  quantity: number;
  inventoryTracking?: string | null;
}): boolean {
  if (item.status !== "active") return false;
  if (isMadeToOrderTracking(item.inventoryTracking)) return true;
  return item.quantity > 0;
}

type StoreItemFeedRow = {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  variants?: unknown;
  status: string;
  quantity: number;
  inventoryTracking?: string | null;
};

/** Feed/embed: only attach store cards for listings that are still publicly buyable. */
export function storeItemRowsToFeedEmbedMap(
  rows: StoreItemFeedRow[]
): Record<string, Omit<StoreItemFeedRow, "status" | "quantity" | "inventoryTracking">> {
  return Object.fromEntries(
    rows
      .filter((s) => isStoreItemPubliclyPurchasable(s))
      .map((s) => [
        s.id,
        {
          id: s.id,
          title: s.title,
          slug: s.slug,
          photos: listingDisplayPhotos(s.photos, "thumb", 1),
          priceCents: s.priceCents,
          variants: s.variants,
        },
      ])
  );
}

/** Sum of all option / SKU quantities. Used to set storeItem.quantity when saving. */
export function sumOptionQuantities(variants: unknown): number {
  if (isMatrixJson(variants)) {
    return sumMatrixQuantities(normalizeVariantMatrix(variants));
  }
  if (!variants || !Array.isArray(variants)) return 0;
  let sum = 0;
  for (const v of variants as VariantWithOptionQuantities[]) {
    if (!Array.isArray(v.options)) continue;
    for (const o of v.options) {
      if (isOptionWithQty(o)) sum += Math.max(0, o.quantity);
    }
  }
  return sum;
}

/** Option labels for one variant row (string[] or { value, quantity }[]). */
export function variantOptionLabels(v: { name?: string; options?: unknown; values?: unknown }): string[] {
  const opts = v?.options ?? v?.values;
  if (!Array.isArray(opts)) return [];
  return opts
    .map((o) => {
      if (isOptionWithQty(o)) return String((o as VariantOptionWithQty).value).trim();
      if (typeof o === "string") return o.trim();
      if (o != null && typeof o === "object" && "value" in o) return String((o as { value: unknown }).value).trim();
      if (o != null) return String(o).trim();
      return "";
    })
    .filter(Boolean);
}

export function listingVariantDisplayAxes(variants: unknown): { name: string; options: string[] }[] {
  const matrix = normalizeVariantMatrix(variants);
  if (matrix && matrix.axes.length > 0) {
    return matrix.axes.map((a) => ({ name: a.name, options: a.values }));
  }
  if (!variants || !Array.isArray(variants)) return [];
  return (variants as { name?: string; options?: unknown }[])
    .map((v) => {
      const name = v.name?.trim() ?? "";
      const options = variantOptionLabels(v);
      return name && options.length > 0 ? { name, options } : null;
    })
    .filter((v): v is { name: string; options: string[] } => v != null);
}

/** True when selectedVariant satisfies every variant axis on the listing. */
export function allVariantAxesSelected(
  variants: unknown,
  selectedVariant: Record<string, string>
): boolean {
  const matrix = normalizeVariantMatrix(variants);
  if (matrix && matrix.axes.length > 0) {
    return allMatrixAxesSelected(matrix, selectedVariant);
  }
  if (!variants || !Array.isArray(variants) || variants.length === 0) return true;
  return (variants as { name?: string; options?: unknown }[]).every((v) => {
    const name = v.name?.trim();
    if (!name) return true;
    const sel = selectedVariant[name];
    if (!sel?.trim()) return false;
    const labels = variantOptionLabels(v);
    return labels.some((l) => l.toLowerCase() === sel.trim().toLowerCase());
  });
}

/** Per-option quantity for one axis value; null when not using per-option stock. */
export function getOptionQuantity(
  variants: unknown,
  axisName: string,
  optionValue: string,
  selectedVariant?: Record<string, string>
): number | null {
  if (!hasOptionQuantities(variants)) return null;
  const matrix = normalizeVariantMatrix(variants);
  if (matrix) {
    const want = optionValue.trim().toLowerCase();
    const axis = matrix.axes.find((a) => a.name.trim().toLowerCase() === axisName.trim().toLowerCase());
    if (!axis) return 0;
    return matrix.skus
      .filter((s) => {
        if (String(s.options[axis.name] ?? "").trim().toLowerCase() !== want) return false;
        if (!selectedVariant) return true;
        for (const [k, v] of Object.entries(selectedVariant)) {
          if (!v?.trim()) continue;
          if (k.trim().toLowerCase() === axis.name.toLowerCase()) continue;
          const skuVal =
            s.options[k] ??
            Object.entries(s.options).find(([n]) => n.trim().toLowerCase() === k.trim().toLowerCase())?.[1];
          if (String(skuVal ?? "").trim().toLowerCase() !== v.trim().toLowerCase()) return false;
        }
        return true;
      })
      .reduce((n, s) => n + Math.max(0, s.quantity), 0);
  }
  if (!variants || !Array.isArray(variants)) return null;
  const want = optionValue.trim().toLowerCase();
  for (const v of variants as VariantWithOptionQuantities[]) {
    const name = v.name?.trim();
    if (!name || name.toLowerCase() !== axisName.trim().toLowerCase()) continue;
    const opts = v.options;
    if (!Array.isArray(opts) || !isOptionWithQty(opts[0])) return null;
    const opt = opts.find((o) => String(o.value).trim().toLowerCase() === want);
    return opt ? Math.max(0, opt.quantity) : 0;
  }
  return null;
}

/** True when a specific option value is out of stock (per-option listings only). */
export function optionIsSoldOut(
  variants: unknown,
  axisName: string,
  optionValue: string,
  inventoryTracking?: string | null,
  selectedVariant?: Record<string, string>
): boolean {
  if (isMadeToOrderTracking(inventoryTracking)) return false;
  const qty = getOptionQuantity(variants, axisName, optionValue, selectedVariant);
  return qty != null && qty <= 0;
}

/**
 * Max quantity a buyer can add for the current selection.
 * Per-option listings return 0 until all axes are selected.
 */
export function getMaxPurchasableQuantity(
  storeItem: QtyItem,
  selectedVariant: Record<string, string>,
  allAxesSelected: boolean
): number {
  if (isMadeToOrderTracking(storeItem.inventoryTracking)) {
    if (hasOptionQuantities(storeItem.variants) && !allAxesSelected) return 0;
    return MTO_PURCHASE_CAP;
  }
  if (hasOptionQuantities(storeItem.variants)) {
    if (!allAxesSelected) return 0;
    return getAvailableQuantity(storeItem, selectedVariant);
  }
  return Math.max(0, storeItem.quantity);
}

/** Option labels for API output. */
export function getOptionValuesForDisplay(variants: unknown): string[] {
  const axes = listingVariantDisplayAxes(variants);
  return axes.flatMap((a) => a.options);
}

export { isMadeToOrderTracking, MTO_PURCHASE_CAP };
