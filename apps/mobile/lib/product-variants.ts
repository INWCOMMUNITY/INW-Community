/** Buyer-facing variant helpers (mirrors apps/main store-item-variants.ts). */

import {
  allMatrixAxesSelected,
  findSkuRow,
  isMadeToOrderTracking,
  matrixToDisplayAxes,
  MTO_PURCHASE_CAP,
  normalizeVariantMatrix,
  skuPhotos,
  skuPriceCents,
  type DisplayVariantAxis,
} from "@/lib/listing-variant-matrix";

export type { DisplayVariantAxis, DisplayVariantOption } from "@/lib/listing-variant-matrix";

/** Normalize API variants for product display and stock checks. */
export function normalizeProductVariants(raw: unknown): DisplayVariantAxis[] {
  const matrix = normalizeVariantMatrix(raw);
  if (matrix && matrix.axes.length > 0) return matrixToDisplayAxes(matrix);
  return [];
}

export function hasPerOptionQuantities(axes: DisplayVariantAxis[]): boolean {
  return axes.some((a) => a.options.some((o) => o.quantity >= 0) && axes.length > 0);
}

export function getAvailableQuantityForSelection(
  item: { quantity: number; variants?: unknown; inventoryTracking?: string | null },
  selectedVariant: Record<string, string>
): number {
  if (isMadeToOrderTracking(item.inventoryTracking)) return MTO_PURCHASE_CAP;
  const matrix = normalizeVariantMatrix(item.variants);
  if (!matrix || matrix.skus.length === 0) return Math.max(0, item.quantity);
  if (!allMatrixAxesSelected(matrix, selectedVariant)) return 0;
  const row = findSkuRow(matrix, selectedVariant);
  return row ? Math.max(0, row.quantity) : 0;
}

export function optionIsSoldOut(
  axis: DisplayVariantAxis,
  value: string,
  variants?: unknown,
  inventoryTracking?: string | null,
  selectedVariant?: Record<string, string>
): boolean {
  if (isMadeToOrderTracking(inventoryTracking)) return false;
  const matrix = normalizeVariantMatrix(variants);
  if (matrix) {
    const matching = matrix.skus.filter((s) => {
      if (String(s.options[axis.name] ?? "").toLowerCase() !== value.toLowerCase()) return false;
      if (!selectedVariant) return true;
      for (const [k, v] of Object.entries(selectedVariant)) {
        if (!v?.trim() || k.toLowerCase() === axis.name.toLowerCase()) continue;
        if (String(s.options[k] ?? "").toLowerCase() !== v.toLowerCase()) return false;
      }
      return true;
    });
    if (matching.length === 0) return true;
    return matching.every((s) => s.quantity <= 0);
  }
  const opt = axis.options.find((o) => o.value.toLowerCase() === value.toLowerCase());
  return opt != null && opt.quantity <= 0;
}

export function getSkuPriceCents(
  item: { priceCents: number; variants?: unknown },
  selectedVariant: Record<string, string>
): number {
  const matrix = normalizeVariantMatrix(item.variants);
  if (!matrix) return item.priceCents;
  const row = findSkuRow(matrix, selectedVariant);
  return skuPriceCents(row, item.priceCents);
}

export function getSkuPhotos(
  item: { photos: string[]; variants?: unknown },
  selectedVariant: Record<string, string>
): string[] {
  const matrix = normalizeVariantMatrix(item.variants);
  if (!matrix) return item.photos ?? [];
  const row = findSkuRow(matrix, selectedVariant);
  return skuPhotos(row, item.photos ?? []);
}

export { browsePriceLabel } from "@/lib/listing-variant-matrix";
