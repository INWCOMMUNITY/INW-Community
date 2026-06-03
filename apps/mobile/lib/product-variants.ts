/** Buyer-facing variant helpers (mirrors apps/main store-item-variants.ts). */

export type DisplayVariantOption = { value: string; quantity: number };
export type DisplayVariantAxis = { name: string; options: DisplayVariantOption[] };

function isOptionWithQty(opt: unknown): opt is DisplayVariantOption {
  return (
    typeof opt === "object" &&
    opt != null &&
    "value" in opt &&
    typeof (opt as DisplayVariantOption).value === "string" &&
    "quantity" in opt &&
    typeof (opt as DisplayVariantOption).quantity === "number"
  );
}

/** Normalize API variants for product display and stock checks. */
export function normalizeProductVariants(raw: unknown): DisplayVariantAxis[] {
  if (!raw || !Array.isArray(raw)) return [];
  return (raw as { name?: string; options?: unknown[] }[])
    .map((v) => {
      const name = typeof v?.name === "string" ? v.name.trim() : "";
      const opts = Array.isArray(v?.options) ? v.options : [];
      const options: DisplayVariantOption[] = opts
        .map((o: unknown) => {
          if (isOptionWithQty(o)) {
            return {
              value: String(o.value).trim(),
              quantity: Math.max(0, Math.round(o.quantity)),
            };
          }
          const label = o != null ? String(o).trim() : "";
          return label ? { value: label, quantity: 0 } : null;
        })
        .filter((o): o is DisplayVariantOption => o != null && o.value.length > 0);
      return name && options.length > 0 ? { name, options } : null;
    })
    .filter((v): v is DisplayVariantAxis => v != null);
}

export function hasPerOptionQuantities(axes: DisplayVariantAxis[]): boolean {
  return axes.some((a) => a.options.some((o) => isOptionWithQty(o)));
}

export function getAvailableQuantityForSelection(
  item: { quantity: number; variants?: unknown },
  selectedVariant: Record<string, string>
): number {
  const axes = normalizeProductVariants(item.variants);
  if (axes.length === 0) return item.quantity;

  for (const axis of axes) {
    const sel = selectedVariant[axis.name];
    if (sel == null || !String(sel).trim()) continue;
    const want = String(sel).trim().toLowerCase();
    const opt = axis.options.find((o) => o.value.toLowerCase() === want);
    if (opt && hasPerOptionQuantities(axes)) return Math.max(0, opt.quantity);
  }

  return item.quantity;
}

export function optionIsSoldOut(axis: DisplayVariantAxis, value: string): boolean {
  if (!hasPerOptionQuantities([axis])) return false;
  const opt = axis.options.find((o) => o.value.toLowerCase() === value.toLowerCase());
  return opt != null && opt.quantity <= 0;
}
