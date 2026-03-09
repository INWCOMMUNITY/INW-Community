/**
 * Helpers for store item variants with per-option quantities.
 * - Legacy: variants[].options = string[] → inventory uses storeItem.quantity.
 * - New: variants[].options = { value: string, quantity: number }[] → inventory per option.
 * Selected variant from cart/checkout: { [variantName]: optionValue } e.g. { Size: "Medium" }.
 */

export type VariantOptionWithQty = { value: string; quantity: number };
export type VariantWithOptionQuantities = { name: string; options: VariantOptionWithQty[] };
export type VariantLegacy = { name?: string; options?: string[] };
export type VariantsJson = VariantWithOptionQuantities[] | VariantLegacy[] | null;

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

/** True if this item uses per-option quantities (new format). */
export function hasOptionQuantities(variants: unknown): boolean {
  if (!variants || !Array.isArray(variants)) return false;
  return (variants as unknown[]).some(isVariantWithOptionQuantities);
}

/** Get available quantity for the item. If selectedVariant is provided and item has option quantities, returns that option's quantity; otherwise storeItem.quantity. */
export function getAvailableQuantity(
  storeItem: { variants?: unknown; quantity: number },
  selectedVariant?: unknown
): number {
  const variants = storeItem.variants as VariantsJson;
  if (!selectedVariant || typeof selectedVariant !== "object") {
    return storeItem.quantity;
  }
  const sel = selectedVariant as Record<string, string>;
  if (!variants || !Array.isArray(variants)) return storeItem.quantity;

  for (const v of variants) {
    const name = (v as { name?: string }).name?.trim();
    if (!name || sel[name] == null) continue;
    const optionValue = String(sel[name]).trim();
    const opts = (v as { options?: unknown[] }).options;
    if (!Array.isArray(opts)) return storeItem.quantity;
    if (isOptionWithQty(opts[0])) {
      const opt = (opts as VariantOptionWithQty[]).find(
        (o) => String(o.value).trim().toLowerCase() === optionValue.toLowerCase()
      );
      return opt ? Math.max(0, opt.quantity) : 0;
    }
    return storeItem.quantity;
  }
  return storeItem.quantity;
}

/** After a purchase: return updated variants JSON with option quantity decremented, and the amount to decrement from storeItem.quantity (for total/sold_out logic). */
export function decrementOptionQuantity(
  variants: unknown,
  selectedVariant: unknown,
  by: number
): { variants: VariantsJson; quantityDelta: number } | null {
  if (!variants || !Array.isArray(variants) || typeof selectedVariant !== "object" || by < 1)
    return null;
  const sel = selectedVariant as Record<string, string>;
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
      opt.quantity = Math.max(0, opt.quantity - by);
      return { variants: next, quantityDelta: by };
    }
  }
  return null;
}

/** Restore inventory (refund/cancel): increment option quantity and return updated variants + delta for storeItem.quantity. */
export function incrementOptionQuantity(
  variants: unknown,
  selectedVariant: unknown,
  by: number
): { variants: VariantsJson; quantityDelta: number } | null {
  if (!variants || !Array.isArray(variants) || typeof selectedVariant !== "object" || by < 1)
    return null;
  const sel = selectedVariant as Record<string, string>;
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

/** Sum of all option quantities (for items with option quantities). Used to set storeItem.quantity when saving. */
export function sumOptionQuantities(variants: unknown): number {
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

/** Normalize options to { value, quantity }[] for API output; legacy string[] options become quantity 0 so UI can show them. */
export function getOptionValuesForDisplay(variants: unknown): string[] {
  if (!variants || !Array.isArray(variants)) return [];
  const out: string[] = [];
  for (const v of variants as VariantLegacy[]) {
    const opts = v?.options;
    if (!Array.isArray(opts)) continue;
    for (const o of opts) {
      if (isOptionWithQty(o)) out.push(String((o as VariantOptionWithQty).value).trim());
      else if (o != null) out.push(String(o).trim());
    }
  }
  return out;
}
