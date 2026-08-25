/** Canonical package weight is total ounces. UI is eBay-style lbs + oz (0–15.99). */

export type PackageMeasurements = {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type PackageFields = {
  weightOz?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
};

export function lbsOzToTotalOz(lbs: number, oz: number): number {
  const pounds = Number.isFinite(lbs) ? Math.max(0, lbs) : 0;
  const ounces = Number.isFinite(oz) ? Math.max(0, oz) : 0;
  return round3(pounds * 16 + ounces);
}

export function totalOzToLbsOz(totalOz: number): { lbs: number; oz: number } {
  const safe = Number.isFinite(totalOz) ? Math.max(0, totalOz) : 0;
  const lbs = Math.floor(safe / 16);
  const oz = round3(safe - lbs * 16);
  return { lbs, oz };
}

/** When oz is 16 or more, carry whole pounds into the lbs field (e.g. 100 oz → 6 lb 4 oz). */
export function carryOuncesIntoPounds(lbs: number, oz: number): { lbs: number; oz: number } {
  return totalOzToLbsOz(lbsOzToTotalOz(lbs, oz));
}

/** Form-string version. Leaves the fields alone while oz is still below 16. */
export function carryOuncesIntoPoundsFields(
  weightLbs: string,
  weightOz: string
): { weightLbs: string; weightOz: string } {
  const lbs = Number(weightLbs.trim() === "" ? 0 : weightLbs);
  const oz = Number(weightOz);
  if (!Number.isFinite(lbs) || !Number.isFinite(oz) || oz < 16) {
    return { weightLbs, weightOz };
  }
  const next = carryOuncesIntoPounds(lbs, oz);
  return {
    weightLbs: String(next.lbs),
    weightOz: String(next.oz),
  };
}

export function convertWeightToOz(value: number, unit?: string | null): number {
  if (!Number.isFinite(value)) return 0;
  const u = String(unit ?? "oz").trim().toLowerCase();
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return round3(value * 16);
  if (u === "g" || u === "gram" || u === "grams") return round3(value / 28.349523125);
  if (u === "kg" || u === "kilogram" || u === "kilograms") return round3(value * 35.27396195);
  return round3(value);
}

export function convertLengthToIn(value: number, unit?: string | null): number {
  if (!Number.isFinite(value)) return 0;
  const u = String(unit ?? "in").trim().toLowerCase();
  if (u === "cm" || u === "centimeter" || u === "centimeters") return round3(value / 2.54);
  if (u === "mm" || u === "millimeter" || u === "millimeters") return round3(value / 25.4);
  if (u === "ft" || u === "foot" || u === "feet") return round3(value * 12);
  return round3(value);
}

export function isPackageComplete(p: PackageFields | null | undefined): p is PackageMeasurements {
  if (!p) return false;
  return (
    isPositive(p.weightOz) &&
    isPositive(p.lengthIn) &&
    isPositive(p.widthIn) &&
    isPositive(p.heightIn)
  );
}

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

export function packageFingerprint(p: PackageMeasurements): string {
  return [round1(p.weightOz), round1(p.lengthIn), round1(p.widthIn), round1(p.heightIn)].join("x");
}

export function combinePackages(
  packages: Array<PackageMeasurements & { quantity?: number }>
): PackageMeasurements | null {
  if (packages.length === 0) return null;
  let weightOz = 0;
  let lengthIn = 0;
  let widthIn = 0;
  let heightIn = 0;
  for (const p of packages) {
    const qty = Math.max(1, p.quantity ?? 1);
    weightOz += p.weightOz * qty;
    lengthIn = Math.max(lengthIn, p.lengthIn);
    widthIn = Math.max(widthIn, p.widthIn);
    heightIn = Math.max(heightIn, p.heightIn);
  }
  return {
    weightOz: round3(weightOz),
    lengthIn: round3(lengthIn),
    widthIn: round3(widthIn),
    heightIn: round3(heightIn),
  };
}

function isPositive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
