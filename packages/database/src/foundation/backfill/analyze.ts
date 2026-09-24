import {
  BackfillItemError,
  SIMPLE_FINGERPRINT,
  type ItemBackfillPlan,
  type PlannedVariant,
} from "./types";

export type LegacyStoreItem = {
  id: string;
  memberId: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  photos: string[];
  quantity: number;
  inventoryTracking: string;
  status: string;
  endedAt: Date | null;
  variants: unknown;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** Canonical option-combination key. Matches listing-variant-matrix `skuSelectionKey`. */
export function optionFingerprint(options: Record<string, string>): string {
  return Object.keys(options)
    .sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
    .map((k) => `${k.trim().toLowerCase()}=${String(options[k] ?? "").trim().toLowerCase()}`)
    .join("|");
}

export function matrixFingerprint(options: Record<string, string>): string {
  return `matrix:${optionFingerprint(options)}`;
}

export function isMadeToOrderTracking(value: string | null | undefined): boolean {
  return value === "made_to_order";
}

function variantStatus(item: LegacyStoreItem): "ACTIVE" | "RETIRED" {
  if (item.endedAt != null || item.status === "inactive") return "RETIRED";
  return "ACTIVE";
}

function trimSku(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectOptions(raw: unknown): Record<string, string> | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) options[name] = val;
  }
  return Object.keys(options).length > 0 ? options : null;
}

function parseNonNegativeInt(raw: unknown, storeItemId: string, label: string): number {
  if (raw == null || raw === "") return 0;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", `${label} is not a finite number`);
  }
  if (n < 0) {
    throw new BackfillItemError(storeItemId, "NEGATIVE_QUANTITY", `${label} is negative (${n})`);
  }
  if (!Number.isInteger(n) && Math.round(n) !== n) {
    return Math.round(n);
  }
  return Math.round(n);
}

function parsePhotos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

function isDisplayOnlyLegacyArray(raw: unknown[]): boolean {
  if (raw.length === 0) return true;
  return raw.every((row) => {
    const rec = asRecord(row);
    if (!rec) return typeof row === "string";
    const opts = rec.options ?? rec.values;
    if (!Array.isArray(opts) || opts.length === 0) return true;
    return opts.every((o) => typeof o === "string" || (o && typeof o === "object" && !("quantity" in o)));
  });
}

function isEmptyVariants(raw: unknown): boolean {
  if (raw == null) return true;
  if (Array.isArray(raw)) return raw.length === 0;
  const rec = asRecord(raw);
  if (!rec) return false;
  return Object.keys(rec).length === 0;
}

type MatrixRow = {
  options: Record<string, string>;
  quantity: number;
  sku: string | null;
  priceCents: number | null;
  compareAtPriceCents: number | null;
  photos: string[];
  barcode: string | null;
};

function parsePriceCents(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw);
}

function parseCanonicalMatrix(storeItemId: string, raw: Record<string, unknown>): MatrixRow[] {
  if (!Array.isArray(raw.axes)) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "matrix.axes must be an array");
  }
  if (!Array.isArray(raw.skus)) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "matrix.skus must be an array");
  }
  if (raw.skus.length === 0) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "matrix has axes but no SKU rows");
  }
  const rows: MatrixRow[] = [];
  for (const skuRaw of raw.skus) {
    const rec = asRecord(skuRaw);
    if (!rec) {
      throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "SKU row is not an object");
    }
    const options = collectOptions(rec.options);
    if (!options) {
      throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "SKU row is missing option combination");
    }
    rows.push({
      options,
      quantity: parseNonNegativeInt(rec.quantity, storeItemId, "SKU row quantity"),
      sku: trimSku(rec.sku),
      priceCents: parsePriceCents(rec.priceCents),
      compareAtPriceCents: parsePriceCents(rec.compareAtPriceCents),
      photos: parsePhotos(rec.photos),
      barcode: trimSku(rec.barcode),
    });
  }
  return rows;
}

/**
 * Live legacy single-axis form from store-item-variants:
 * `[{ name, options: [{ value, quantity, sku? }] }]`.
 * Multi-axis option-quantity arrays are rejected: cartesian expansion would invent combinations.
 */
function parseLegacyQtyArray(storeItemId: string, raw: unknown[]): MatrixRow[] {
  const qtyAxes = raw.filter((row) => {
    const rec = asRecord(row);
    if (!rec) return false;
    const opts = rec.options ?? rec.values;
    if (!Array.isArray(opts) || opts.length === 0) return false;
    return opts.some((o) => o && typeof o === "object" && "quantity" in o);
  });
  if (qtyAxes.length === 0) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "legacy variants array is not a quantity matrix");
  }
  if (qtyAxes.length > 1) {
    throw new BackfillItemError(
      storeItemId,
      "INVALID_MATRIX",
      "Multi-axis legacy option-quantity arrays are ambiguous; cartesian expansion is not used"
    );
  }
  const rec = asRecord(qtyAxes[0]);
  if (!rec) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "legacy option-quantity axis is not an object");
  }
  const axisName = String(rec.name ?? rec.axis ?? "").trim() || "Option";
  const opts = (rec.options ?? rec.values) as unknown[];
  const rows: MatrixRow[] = [];
  for (const o of opts) {
    if (typeof o === "string") {
      const value = o.trim();
      if (!value) continue;
      rows.push({
        options: { [axisName]: value },
        quantity: 0,
        sku: null,
        priceCents: null,
        compareAtPriceCents: null,
        photos: [],
        barcode: null,
      });
      continue;
    }
    const ore = asRecord(o);
    if (!ore) {
      throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "legacy option row is not an object");
    }
    const value = String(ore.value ?? ore.label ?? "").trim();
    if (!value) {
      throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "legacy option row is missing a value");
    }
    rows.push({
      options: { [axisName]: value },
      quantity: parseNonNegativeInt(ore.quantity, storeItemId, "legacy option quantity"),
      sku: trimSku(ore.sku),
      priceCents: parsePriceCents(ore.priceCents),
      compareAtPriceCents: parsePriceCents(ore.compareAtPriceCents),
      photos: parsePhotos(ore.photos),
      barcode: trimSku(ore.barcode),
    });
  }
  if (rows.length === 0) {
    throw new BackfillItemError(storeItemId, "INVALID_MATRIX", "legacy option-quantity axis has no rows");
  }
  return rows;
}

function assignDefaultAndSort(rows: PlannedVariant[]): PlannedVariant[] {
  const sorted = [...rows].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return sorted.map((row, index) => ({
    ...row,
    isDefault: index === 0,
    sortOrder: index,
  }));
}

function duplicateSkuValues(rows: PlannedVariant[]): string[] {
  const bySku = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = row.sku.toLowerCase();
    const list = bySku.get(key) ?? [];
    list.push(row.fingerprint);
    bySku.set(key, list);
  }
  return [...bySku.entries()].filter(([, fps]) => fps.length > 1).map(([sku]) => sku);
}

/**
 * Default Variant for a matrix item is the lexicographically smallest migration fingerprint.
 * Legacy JSON has no explicit default-row flag; this is independent of qty, price, SKU, photos, and row order.
 */
export function analyzeStoreItem(item: LegacyStoreItem): ItemBackfillPlan {
  const tracking = item.inventoryTracking || "tracked";
  if (tracking !== "tracked" && tracking !== "made_to_order") {
    throw new BackfillItemError(item.id, "AMBIGUOUS_MODE", `Unrecognized inventoryTracking "${tracking}"`);
  }
  const mode: ItemBackfillPlan["mode"] = tracking === "made_to_order" ? "MADE_TO_ORDER" : "TRACKED_FINITE";

  if (isEmptyVariants(item.variants) || (Array.isArray(item.variants) && isDisplayOnlyLegacyArray(item.variants))) {
    if (mode === "TRACKED_FINITE" && item.quantity < 0) {
      throw new BackfillItemError(item.id, "NEGATIVE_QUANTITY", `StoreItem.quantity is negative (${item.quantity})`);
    }
    const simple: PlannedVariant = {
      fingerprint: SIMPLE_FINGERPRINT,
      isDefault: true,
      options: {},
      sku: trimSku(item.sku),
      barcode: trimSku(item.barcode),
      priceCents: item.priceCents,
      compareAtPriceCents: item.compareAtPriceCents,
      photos: [...item.photos],
      sortOrder: 0,
      openingQty: mode === "MADE_TO_ORDER" ? null : item.quantity,
    };
    return {
      storeItemId: item.id,
      memberId: item.memberId,
      kind: "simple",
      mode,
      variantStatus: variantStatus(item),
      variants: [simple],
      parentQuantity: item.quantity,
      matrixQuantitySum: null,
      quantityDiverges: false,
      duplicateSkus: [],
    };
  }

  let rows: MatrixRow[];
  if (Array.isArray(item.variants)) {
    rows = parseLegacyQtyArray(item.id, item.variants);
  } else {
    const rec = asRecord(item.variants);
    if (!rec || !Array.isArray(rec.axes)) {
      throw new BackfillItemError(item.id, "INVALID_MATRIX", "variants JSON is not a canonical matrix or simple listing");
    }
    rows = parseCanonicalMatrix(item.id, rec);
  }

  const planned: PlannedVariant[] = rows.map((row) => ({
    fingerprint: matrixFingerprint(row.options),
    isDefault: false,
    options: row.options,
    sku: row.sku,
    barcode: row.barcode ?? trimSku(item.barcode),
    priceCents: row.priceCents ?? item.priceCents,
    compareAtPriceCents: row.compareAtPriceCents ?? item.compareAtPriceCents,
    photos: row.photos.length > 0 ? row.photos : [...item.photos],
    sortOrder: 0,
    openingQty: mode === "MADE_TO_ORDER" ? null : row.quantity,
  }));

  const byFp = new Map<string, number>();
  for (const row of planned) {
    byFp.set(row.fingerprint, (byFp.get(row.fingerprint) ?? 0) + 1);
  }
  const ambiguous = [...byFp.entries()].filter(([, n]) => n > 1);
  if (ambiguous.length > 0) {
    throw new BackfillItemError(
      item.id,
      "AMBIGUOUS_FINGERPRINT",
      `Duplicate option fingerprints: ${ambiguous.map(([fp]) => fp).join(", ")}`
    );
  }

  const variants = assignDefaultAndSort(planned);
  const matrixQuantitySum = rows.reduce((n, r) => n + r.quantity, 0);
  return {
    storeItemId: item.id,
    memberId: item.memberId,
    kind: "matrix",
    mode,
    variantStatus: variantStatus(item),
    variants,
    parentQuantity: item.quantity,
    matrixQuantitySum,
    quantityDiverges: mode === "TRACKED_FINITE" && matrixQuantitySum !== item.quantity,
    duplicateSkus: duplicateSkuValues(variants),
  };
}
