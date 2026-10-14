export type EtsyListingPackage = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number | null;
};

const DIM_TO_IN: Record<string, number> = {
  in: 1,
  inch: 1,
  inches: 1,
  ft: 12,
  foot: 12,
  feet: 12,
  mm: 1 / 25.4,
  cm: 1 / 2.54,
  m: 39.3700787,
  yd: 36,
  yds: 36,
  yard: 36,
  yards: 36,
};

const WEIGHT_TO_OZ: Record<string, number> = {
  oz: 1,
  ounce: 1,
  ounces: 1,
  lb: 16,
  lbs: 16,
  pound: 16,
  pounds: 16,
  g: 1 / 28.349523125,
  kg: 35.27396195,
};

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Package size from an Etsy listing. All three dimensions are required. */
export function etsyListingPackageFromRaw(row: {
  item_length?: unknown;
  item_width?: unknown;
  item_height?: unknown;
  item_dimensions_unit?: unknown;
  item_weight?: unknown;
  item_weight_unit?: unknown;
}): EtsyListingPackage | null {
  const unit = String(row.item_dimensions_unit ?? "in")
    .trim()
    .toLowerCase();
  const factor = DIM_TO_IN[unit];
  if (!factor) return null;
  const length = positiveNumber(row.item_length);
  const width = positiveNumber(row.item_width);
  const height = positiveNumber(row.item_height);
  if (length == null || width == null || height == null) return null;

  const weightUnit = String(row.item_weight_unit ?? "oz")
    .trim()
    .toLowerCase();
  const weightFactor = WEIGHT_TO_OZ[weightUnit];
  const weight = positiveNumber(row.item_weight);
  const weightOz =
    weight != null && weightFactor ? round3(weight * weightFactor) : null;

  return {
    lengthIn: round3(length * factor),
    widthIn: round3(width * factor),
    heightIn: round3(height * factor),
    weightOz,
  };
}

const MAX_SHIPPING_CENTS = 10_000_000;

/** Dollars typed by the seller, such as "12.50". Blank is unset. */
export function parseSellerShippingDollars(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_SHIPPING_CENTS) return null;
  return cents;
}

export function formatShippingCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
