/** Imported eBay/Etsy options are usable without package measurements. */
export function shippingOptionNeedsMeasurements(opt: {
  source?: string | null;
  complete: boolean;
}): boolean {
  return opt.source === "inw" && !opt.complete;
}

export function formatShippingOptionPackageSummary(
  opt: {
    source?: string | null;
    complete: boolean;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    weightLbs: number;
    weightOzRemainder: number;
  },
  incompleteInwMessage = "Needs weight and size"
): string {
  if (opt.complete) {
    return `${opt.lengthIn}×${opt.widthIn}×${opt.heightIn} in · ${opt.weightLbs} lb ${opt.weightOzRemainder} oz`;
  }
  return shippingOptionNeedsMeasurements(opt) ? incompleteInwMessage : "";
}
