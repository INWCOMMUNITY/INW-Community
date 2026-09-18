export const SIMPLE_FINGERPRINT = "simple:default";
export const OPENING_SOURCE_SYSTEM = "inw";
export const OPENING_SOURCE_SCOPE = "commerce-foundation-backfill";
export const OPENING_CAUSE = "SYSTEM_MIGRATION";

export function openingFactId(variantId: string): string {
  return `opening:${variantId}`;
}

export type BackfillFailureCode =
  | "NEGATIVE_QUANTITY"
  | "INVALID_MATRIX"
  | "AMBIGUOUS_FINGERPRINT"
  | "INCONSISTENT_MAP_MISSING_VARIANT"
  | "INCONSISTENT_VARIANT_OWNERSHIP"
  | "INCONSISTENT_EXISTING"
  | "AMBIGUOUS_MODE";

export type PlannedVariant = {
  fingerprint: string;
  isDefault: boolean;
  options: Record<string, string>;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  photos: string[];
  sortOrder: number;
  /** Finite opening on-hand for TRACKED_FINITE; null for MADE_TO_ORDER. */
  openingQty: number | null;
};

export type ItemBackfillPlan = {
  storeItemId: string;
  memberId: string;
  kind: "simple" | "matrix";
  mode: "TRACKED_FINITE" | "MADE_TO_ORDER";
  variantStatus: "ACTIVE" | "RETIRED";
  variants: PlannedVariant[];
  parentQuantity: number;
  matrixQuantitySum: number | null;
  quantityDiverges: boolean;
  duplicateSkus: string[];
};

export type BackfillItemOutcome =
  | { status: "created" | "verified"; plan: ItemBackfillPlan; variantIds: string[] }
  | { status: "failed"; storeItemId: string; code: BackfillFailureCode; message: string };

export type QuantityDivergence = {
  storeItemId: string;
  parentQuantity: number;
  matrixSum: number;
};

export type DuplicateSkuObservation = {
  storeItemId: string;
  sku: string;
  fingerprints: string[];
};

export type BackfillFailure = {
  storeItemId: string;
  code: BackfillFailureCode;
  message: string;
};

export type BackfillRunReport = {
  itemsScanned: number;
  itemsEligible: number;
  itemsBackfilled: number;
  itemsVerified: number;
  itemsFailed: number;
  simpleVariantsCreated: number;
  matrixVariantsCreated: number;
  mtoVariants: number;
  openingBalancesCreated: number;
  quantityDivergences: QuantityDivergence[];
  duplicateSkus: DuplicateSkuObservation[];
  ambiguousFingerprints: BackfillFailure[];
  invalidMatrix: BackfillFailure[];
  inconsistentExisting: BackfillFailure[];
  failures: BackfillFailure[];
};

export class BackfillItemError extends Error {
  readonly code: BackfillFailureCode;
  readonly storeItemId: string;

  constructor(storeItemId: string, code: BackfillFailureCode, message: string) {
    super(message);
    this.name = "BackfillItemError";
    this.storeItemId = storeItemId;
    this.code = code;
  }
}

export function emptyReport(): BackfillRunReport {
  return {
    itemsScanned: 0,
    itemsEligible: 0,
    itemsBackfilled: 0,
    itemsVerified: 0,
    itemsFailed: 0,
    simpleVariantsCreated: 0,
    matrixVariantsCreated: 0,
    mtoVariants: 0,
    openingBalancesCreated: 0,
    quantityDivergences: [],
    duplicateSkus: [],
    ambiguousFingerprints: [],
    invalidMatrix: [],
    inconsistentExisting: [],
    failures: [],
  };
}
