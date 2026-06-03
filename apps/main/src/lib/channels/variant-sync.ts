import { createHash } from "crypto";
import type { ChannelProvider } from "./types";

export type InwVariantAxis = {
  name: string;
  options: { value: string; quantity: number }[];
};

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

/** Normalize any provider variant payload to INW per-option-quantity format. */
export function normalizeVariantsFromProvider(
  _provider: ChannelProvider,
  remoteVariants: unknown
): InwVariantAxis[] | null {
  if (!remoteVariants || !Array.isArray(remoteVariants) || remoteVariants.length === 0) {
    return null;
  }

  const axes: InwVariantAxis[] = [];
  for (const row of remoteVariants as Record<string, unknown>[]) {
    const name = String(row.name ?? row.optionName ?? row.property_name ?? "Option").trim();
    if (!name) continue;

    const rawOpts = row.options ?? row.values ?? row.choices;
    if (!Array.isArray(rawOpts) || rawOpts.length === 0) continue;

    const options: { value: string; quantity: number }[] = [];
    for (const o of rawOpts) {
      if (isOptionWithQty(o)) {
        options.push({
          value: String(o.value).trim(),
          quantity: Math.max(0, Math.round(o.quantity)),
        });
      } else if (typeof o === "object" && o != null) {
        const obj = o as Record<string, unknown>;
        const value = String(obj.value ?? obj.label ?? obj.name ?? "").trim();
        if (!value) continue;
        const qty =
          typeof obj.quantity === "number"
            ? Math.max(0, Math.round(obj.quantity))
            : typeof obj.inventory_quantity === "number"
              ? Math.max(0, Math.round(obj.inventory_quantity))
              : 0;
        options.push({ value, quantity: qty });
      } else if (o != null) {
        options.push({ value: String(o).trim(), quantity: 0 });
      }
    }
    if (options.length > 0) axes.push({ name: name.slice(0, 80), options });
  }

  return axes.length > 0 ? axes : null;
}

/** Stable fingerprint for baseline meta sync. */
export function variantsFingerprint(variants: unknown): string {
  const normalized = normalizeVariantsFromProvider("wix", variants);
  if (!normalized) return "";
  const compact = normalized.map((a) => ({
    n: a.name,
    o: a.options
      .map((opt) => ({ v: opt.value, q: opt.quantity }))
      .sort((x, y) => x.v.localeCompare(y.v)),
  }));
  return createHash("sha1").update(JSON.stringify(compact)).digest("hex");
}

/** Sum all option quantities. */
export function sumVariantQuantities(variants: InwVariantAxis[] | null): number {
  if (!variants) return 0;
  let sum = 0;
  for (const axis of variants) {
    for (const o of axis.options) sum += Math.max(0, o.quantity);
  }
  return sum;
}

/** Match a sale's variant map to INW option rows for decrement. */
export function matchSaleToVariantOption(
  saleVariant: Record<string, string> | null | undefined,
  variants: unknown
): Record<string, string> | null {
  if (!saleVariant || typeof saleVariant !== "object") return null;
  const normalized = normalizeVariantsFromProvider("wix", variants);
  if (!normalized || normalized.length === 0) return null;

  const out: Record<string, string> = {};
  for (const axis of normalized) {
    for (const key of Object.keys(saleVariant)) {
      if (key.toLowerCase() !== axis.name.toLowerCase()) continue;
      const val = saleVariant[key]?.trim();
      if (val) out[axis.name] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Shopify allows max 3 option axes. */
export function validateVariantLimits(
  provider: ChannelProvider,
  variants: InwVariantAxis[] | null
): string | null {
  if (!variants) return null;
  if (provider === "shopify" && variants.length > 3) {
    return "Shopify supports at most 3 product options.";
  }
  for (const axis of variants) {
    if (axis.options.length === 0) return `Option "${axis.name}" has no values.`;
    if (provider === "shopify") {
      const total = variants.reduce((n, a) => n * Math.max(1, a.options.length), 1);
      if (total > 100) return "Shopify supports at most 100 variants per product.";
    }
  }
  return null;
}

const MAX_INW_OPTION_VALUES = 50;

/** Validate INW canonical variants on seller save (single-axis cross-channel contract). */
export function validateInwVariantsForSave(variants: unknown): string | null {
  if (variants == null) return null;
  if (!Array.isArray(variants) || variants.length === 0) return null;

  const normalized = normalizeVariantsFromProvider("wix", variants);
  if (!normalized || normalized.length === 0) {
    return "Invalid option format.";
  }
  if (normalized.length > 1) {
    return "Linked channels support one option type (e.g. Size). Remove extra option groups.";
  }

  const axis = normalized[0];
  if (!axis.name.trim()) return "Option type name is required (e.g. Size).";
  if (axis.options.length === 0) return "Add at least one option value.";
  if (axis.options.length > MAX_INW_OPTION_VALUES) {
    return `At most ${MAX_INW_OPTION_VALUES} option values are allowed.`;
  }

  const seen = new Set<string>();
  for (const o of axis.options) {
    const key = o.value.trim().toLowerCase();
    if (!key) return "Option values cannot be empty.";
    if (seen.has(key)) return `Duplicate option value "${o.value}".`;
    seen.add(key);
  }
  return null;
}

/** Build provider-specific variant payload stub — adapters extend with API details. */
export function buildProviderVariants(
  provider: ChannelProvider,
  inwVariants: InwVariantAxis[] | null
): unknown {
  if (!inwVariants || inwVariants.length === 0) return null;
  return { provider, axes: inwVariants };
}
