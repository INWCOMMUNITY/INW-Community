/**
 * Package weight/size for Etsy listings.
 * Calculated shipping profiles require these fields on create/activate.
 */

export const ETSY_DEFAULT_PACKAGE = {
  /** Small craft parcel fallback when the listing has no shipping option measurements. */
  weightOz: 8,
  lengthIn: 8,
  widthIn: 6,
  heightIn: 4,
} as const;

export type EtsyListingPackageFields = {
  item_weight: number;
  item_weight_unit: "oz";
  item_length: number;
  item_width: number;
  item_height: number;
  item_dimensions_unit: "in";
};

function positiveOr(
  value: number | null | undefined,
  fallback: number
): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value * 1000) / 1000
    : fallback;
}

/**
 * Prefer the linked INW shipping option measurements; fill gaps with a safe default
 * so calculated Etsy shipping profiles can be attached without blocking the seller.
 */
export function resolveEtsyListingPackageFields(
  option?: {
    weightOz?: number | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
  } | null
): EtsyListingPackageFields & { source: "shipping_option" | "default" | "mixed" } {
  const hasAny =
    (typeof option?.weightOz === "number" && option.weightOz > 0) ||
    (typeof option?.lengthIn === "number" && option.lengthIn > 0) ||
    (typeof option?.widthIn === "number" && option.widthIn > 0) ||
    (typeof option?.heightIn === "number" && option.heightIn > 0);
  const hasAll =
    typeof option?.weightOz === "number" &&
    option.weightOz > 0 &&
    typeof option?.lengthIn === "number" &&
    option.lengthIn > 0 &&
    typeof option?.widthIn === "number" &&
    option.widthIn > 0 &&
    typeof option?.heightIn === "number" &&
    option.heightIn > 0;

  return {
    item_weight: positiveOr(option?.weightOz, ETSY_DEFAULT_PACKAGE.weightOz),
    item_weight_unit: "oz",
    item_length: positiveOr(option?.lengthIn, ETSY_DEFAULT_PACKAGE.lengthIn),
    item_width: positiveOr(option?.widthIn, ETSY_DEFAULT_PACKAGE.widthIn),
    item_height: positiveOr(option?.heightIn, ETSY_DEFAULT_PACKAGE.heightIn),
    item_dimensions_unit: "in",
    source: hasAll ? "shipping_option" : hasAny ? "mixed" : "default",
  };
}
