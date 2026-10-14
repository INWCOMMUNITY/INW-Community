export type EtsyImportShippingPolicy = "IMPORT_PRICES" | "FREE";

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

/**
 * INW shipping charge for an imported listing.
 * A fixed domestic price is used only when the listing also has package dimensions.
 * Everything else, including "Ship Free with INW", is $0.
 */
export function importedInwShippingCents(input: {
  policy: EtsyImportShippingPolicy;
  packageDimensions: EtsyListingPackage | null;
  domesticShippingCents: number | null;
}): number {
  if (input.policy !== "IMPORT_PRICES") return 0;
  if (!input.packageDimensions) return 0;
  if (input.domesticShippingCents == null || !Number.isFinite(input.domesticShippingCents)) return 0;
  return Math.max(0, Math.round(input.domesticShippingCents));
}

export function shouldAttachImportedEtsyPackage(input: {
  policy: EtsyImportShippingPolicy;
  packageDimensions: EtsyListingPackage | null;
  domesticShippingCents: number | null;
}): boolean {
  return (
    input.policy === "IMPORT_PRICES" &&
    input.packageDimensions != null &&
    input.domesticShippingCents != null &&
    Number.isFinite(input.domesticShippingCents)
  );
}
