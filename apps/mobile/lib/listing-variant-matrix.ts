/**
 * Canonical listing variant matrix: option axes + per-combination SKU rows.
 * Legacy INW JSON is an array of { name, options } (one qty per value, not per combo).
 */

export const INVENTORY_TRACKING_TRACKED = "tracked";
export const INVENTORY_TRACKING_MADE_TO_ORDER = "made_to_order";
export type InventoryTracking = typeof INVENTORY_TRACKING_TRACKED | typeof INVENTORY_TRACKING_MADE_TO_ORDER;

export const MTO_CHANNEL_QUANTITY = 999;
export const MTO_PURCHASE_CAP = 99;
export const MAX_VARIANT_AXES = 3;
/** INW / eBay combination cap. Shopify REST stays at MAX_SKU_ROWS_SHOPIFY. */
export const MAX_SKU_ROWS_DEFAULT = 250;
export const MAX_SKU_ROWS_EBAY = 250;
export const MAX_SKU_ROWS_SHOPIFY = 100;
export const MAX_ETSY_AXES = 3;
/** Etsy rejects 3-variation listings that vary price/qty/SKU on all properties above this. */
export const MAX_ETSY_SKUS_ALL_PROPERTIES = 400;
export const MAX_VALUES_PER_AXIS = 50;

export type VariantAxisDef = {
  name: string;
  values: string[];
  /** Listing-gallery URLs linked to a value (typically Color). */
  photosByValue?: Record<string, string[]>;
};

export type VariantSkuRow = {
  options: Record<string, string>;
  quantity: number;
  priceCents?: number;
  photos?: string[];
  sku?: string;
};

export type VariantMatrix = {
  axes: VariantAxisDef[];
  skus: VariantSkuRow[];
  pricesVary?: boolean;
  quantitiesVary?: boolean;
  skusVary?: boolean;
  /** Option type whose values own photos (Etsy/eBay allow one). */
  imageAxis?: string | null;
};

export function isMadeToOrderTracking(value: string | null | undefined): boolean {
  return value === INVENTORY_TRACKING_MADE_TO_ORDER;
}

export function parseInventoryTracking(value: unknown): InventoryTracking {
  return value === INVENTORY_TRACKING_MADE_TO_ORDER
    ? INVENTORY_TRACKING_MADE_TO_ORDER
    : INVENTORY_TRACKING_TRACKED;
}

export function channelQuantityForTracked(qty: number, tracking?: string | null): number {
  if (isMadeToOrderTracking(tracking)) return MTO_CHANNEL_QUANTITY;
  return Math.max(0, qty);
}

export function purchasableCap(tracking?: string | null): number | null {
  return isMadeToOrderTracking(tracking) ? MTO_PURCHASE_CAP : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function readSku(opt: unknown): string | undefined {
  if (typeof opt !== "object" || opt == null) return undefined;
  const sku = (opt as { sku?: unknown }).sku;
  if (typeof sku !== "string") return undefined;
  const trimmed = sku.trim();
  return trimmed || undefined;
}

function readQty(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return 0;
}

function optionLabel(o: unknown): string {
  if (typeof o === "string") return o.trim();
  if (typeof o === "number") return String(o).trim();
  if (o && typeof o === "object") {
    const rec = o as Record<string, unknown>;
    const v = rec.value ?? rec.label ?? rec.name;
    if (v != null) return String(v).trim();
  }
  return o != null ? String(o).trim() : "";
}

function optionQuantity(o: unknown): number {
  if (o && typeof o === "object" && "quantity" in (o as object)) {
    return readQty((o as { quantity: unknown }).quantity);
  }
  if (o && typeof o === "object" && "inventory_quantity" in (o as object)) {
    return readQty((o as { inventory_quantity: unknown }).inventory_quantity);
  }
  return 0;
}

function optionPriceCents(o: unknown): number | undefined {
  if (!o || typeof o !== "object") return undefined;
  const rec = o as Record<string, unknown>;
  if (typeof rec.priceCents === "number" && Number.isFinite(rec.priceCents) && rec.priceCents > 0) {
    return Math.round(rec.priceCents);
  }
  return undefined;
}

function optionPhotos(o: unknown): string[] | undefined {
  if (!o || typeof o !== "object") return undefined;
  const photos = (o as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return undefined;
  const urls = photos.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return urls.length > 0 ? urls : undefined;
}

function readBoolFlag(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  return undefined;
}

function parsePhotoUrlList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const urls = raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return urls.length > 0 ? urls : undefined;
}

function parsePhotosByValue(raw: unknown): Record<string, string[]> | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(rec)) {
    const urls = parsePhotoUrlList(val);
    if (key.trim() && urls) out[key.trim()] = urls;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function photosByValueForLabel(
  photosByValue: Record<string, string[]> | undefined,
  value: string
): string[] | undefined {
  if (!photosByValue) return undefined;
  const want = value.trim().toLowerCase();
  for (const [k, urls] of Object.entries(photosByValue)) {
    if (k.trim().toLowerCase() === want && urls.length > 0) return urls;
  }
  return undefined;
}

export function matrixMetaFrom(
  matrix: Pick<VariantMatrix, "pricesVary" | "quantitiesVary" | "skusVary" | "imageAxis">
): Pick<VariantMatrix, "pricesVary" | "quantitiesVary" | "skusVary" | "imageAxis"> {
  return {
    ...(matrix.pricesVary != null ? { pricesVary: matrix.pricesVary } : {}),
    ...(matrix.quantitiesVary != null ? { quantitiesVary: matrix.quantitiesVary } : {}),
    ...(matrix.skusVary != null ? { skusVary: matrix.skusVary } : {}),
    ...(matrix.imageAxis !== undefined ? { imageAxis: matrix.imageAxis } : {}),
  };
}

export function inferMatrixVaryFlags(matrix: VariantMatrix): {
  pricesVary: boolean;
  quantitiesVary: boolean;
  skusVary: boolean;
} {
  const pricesVary =
    matrix.pricesVary ?? matrix.skus.some((s) => s.priceCents != null && s.priceCents > 0);
  const skusVary = matrix.skusVary ?? matrix.skus.some((s) => Boolean(s.sku?.trim()));
  const qtys = matrix.skus.map((s) => s.quantity);
  const quantitiesVary =
    matrix.quantitiesVary ?? (qtys.length > 1 && new Set(qtys).size > 1);
  return { pricesVary, quantitiesVary, skusVary };
}

const VARIANT_PRICE_DRAFT_RE = /^\d*(\.\d{0,2})?$/;

/** True while the seller is typing a price (`""`, `"1"`, `"1."`, `"18.5"`). */
export function isVariantPriceDraftInput(raw: string): boolean {
  return VARIANT_PRICE_DRAFT_RE.test(raw.trim());
}

/** Cents from a complete draft. Trailing `.` and empty/invalid values are incomplete. */
export function variantPriceDraftToCents(raw: string): number | undefined {
  const t = raw.trim().replace(/^\$/, "");
  if (!t || t === "." || t.endsWith(".")) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100);
}

/** Idle display (`18.00`). Not used while the field is focused. */
export function formatVariantPriceCents(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return "";
  return (cents / 100).toFixed(2);
}

/** Focused display so typing `1` then `8` becomes `18`, not `1.008`. */
export function variantPriceCentsToEditable(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return "";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

export function resolveImageAxisName(matrix: VariantMatrix): string | null {
  if (matrix.imageAxis?.trim()) {
    const named = matrix.axes.find(
      (a) => a.name.trim().toLowerCase() === matrix.imageAxis!.trim().toLowerCase()
    );
    if (named) return named.name;
  }
  const withPhotos = matrix.axes.find(
    (a) => a.photosByValue && Object.values(a.photosByValue).some((u) => u.length > 0)
  );
  return withPhotos?.name ?? null;
}

export function matrixHasLinkedOptionPhotos(matrix: VariantMatrix): boolean {
  if (resolveImageAxisName(matrix)) return true;
  return matrix.skus.some((s) => (s.photos?.length ?? 0) > 0);
}

/** True when Etsy would send *_on_property with every variation property (400-product cap). */
export function etsyVariesByAllProperties(matrix: VariantMatrix): boolean {
  if (matrix.axes.length < 2) return false;
  const flags = inferMatrixVaryFlags(matrix);
  const anyVary = flags.pricesVary || flags.quantitiesVary || flags.skusVary;
  return anyVary && matrix.axes.length === MAX_ETSY_AXES;
}

export function resolveSkuPhotosFromAxes(
  options: Record<string, string>,
  axes: VariantAxisDef[],
  imageAxis?: string | null,
  prevPhotos?: string[]
): string[] | undefined {
  const axisName =
    imageAxis?.trim() ||
    axes.find((a) => a.photosByValue && Object.values(a.photosByValue).some((u) => u.length > 0))
      ?.name;
  if (axisName) {
    const axis = axes.find((a) => a.name.trim().toLowerCase() === axisName.trim().toLowerCase());
    const value =
      (axis ? options[axis.name] : null) ??
      Object.entries(options).find(([k]) => k.trim().toLowerCase() === axisName.trim().toLowerCase())?.[1];
    const fromAxis = photosByValueForLabel(axis?.photosByValue, value ?? "");
    if (fromAxis?.length) return fromAxis;
    // Image axis is set: do not keep stale SKU thumbs after unlink or axis switch.
    return undefined;
  }
  if (prevPhotos && prevPhotos.length > 0) return prevPhotos;
  return undefined;
}

/** Gallery thumbs in Manage variations — keep blob: URLs for unsaved uploads. */
export function listingGalleryPhotoChoices(galleryPhotos: string[]): string[] {
  return galleryPhotos.filter((u) => {
    const url = u?.trim();
    if (!url) return false;
    if (url.startsWith("blob:") || url.startsWith("data:")) return true;
    return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/");
  });
}

export function optionsEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bNorm = new Map(bKeys.map((k) => [k.trim().toLowerCase(), String(b[k] ?? "").trim().toLowerCase()]));
  for (const k of aKeys) {
    const want = String(a[k] ?? "").trim().toLowerCase();
    const got = bNorm.get(k.trim().toLowerCase());
    if (got !== want) return false;
  }
  return true;
}

export function skuSelectionKey(options: Record<string, string>): string {
  return Object.keys(options)
    .sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
    .map((k) => `${k.trim().toLowerCase()}=${String(options[k] ?? "").trim().toLowerCase()}`)
    .join("|");
}

export function findSkuRow(
  matrix: VariantMatrix,
  selection: Record<string, string> | null | undefined
): VariantSkuRow | null {
  if (!selection || typeof selection !== "object") return null;
  const sel: Record<string, string> = {};
  for (const [k, v] of Object.entries(selection)) {
    if (v != null && String(v).trim()) sel[k] = String(v).trim();
  }
  if (Object.keys(sel).length === 0) return null;
  return matrix.skus.find((row) => optionsEqual(row.options, sel)) ?? null;
}

export function allMatrixAxesSelected(
  matrix: VariantMatrix,
  selection: Record<string, string>
): boolean {
  if (matrix.axes.length === 0) return true;
  return matrix.axes.every((axis) => {
    const name = axis.name.trim();
    if (!name) return true;
    const sel =
      selection[name] ??
      Object.entries(selection).find(([k]) => k.trim().toLowerCase() === name.toLowerCase())?.[1];
    if (!sel?.trim()) return false;
    const want = sel.trim().toLowerCase();
    return axis.values.some((v) => v.trim().toLowerCase() === want);
  });
}

export function channelTreatsItemInStock(item: {
  quantity?: number | null;
  inventoryTracking?: string | null;
}): boolean {
  if (isMadeToOrderTracking(item.inventoryTracking)) return true;
  return (item.quantity ?? 0) > 0;
}

/** Rebuild cartesian SKU rows, copying qty/price/photos/sku from matching previous rows. */
export function rebuildMatrixFromAxes(
  axes: VariantAxisDef[],
  previousSkus: VariantSkuRow[] = [],
  meta?: Pick<VariantMatrix, "pricesVary" | "quantitiesVary" | "skusVary" | "imageAxis">
): VariantMatrix {
  const cleanAxes = axes
    .map((a) => ({
      name: a.name.trim().slice(0, 80),
      values: [...new Set(a.values.map((v) => v.trim()).filter(Boolean))],
      ...(a.photosByValue ? { photosByValue: parsePhotosByValue(a.photosByValue) } : {}),
    }))
    .filter((a) => a.name && a.values.length > 0);
  const imageAxis = meta?.imageAxis?.trim() || cleanAxes.find((a) => a.photosByValue)?.name || null;
  const combos = cartesianOptionMaps(cleanAxes);
  const skus: VariantSkuRow[] = [];
  for (const options of combos) {
    const prev = previousSkus.find((s) => optionsEqual(s.options, options));
    const photos = resolveSkuPhotosFromAxes(options, cleanAxes, imageAxis, prev?.photos);
    if (prev) {
      skus.push({
        options,
        quantity: Math.max(0, prev.quantity),
        ...(prev.priceCents != null && prev.priceCents > 0 ? { priceCents: prev.priceCents } : {}),
        ...(photos && photos.length > 0 ? { photos } : {}),
        ...(prev.sku?.trim() ? { sku: prev.sku.trim() } : {}),
      });
    } else {
      skus.push({
        options,
        quantity: 0,
        ...(photos && photos.length > 0 ? { photos } : {}),
      });
    }
  }
  return {
    axes: cleanAxes,
    skus,
    ...matrixMetaFrom({
      pricesVary: meta?.pricesVary,
      quantitiesVary: meta?.quantitiesVary,
      skusVary: meta?.skusVary,
      imageAxis,
    }),
  };
}

export function cartesianOptionMaps(axes: VariantAxisDef[]): Record<string, string>[] {
  if (axes.length === 0) return [];
  let combos: Record<string, string>[] = [{}];
  for (const axis of axes) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ ...combo, [axis.name]: value });
      }
    }
    combos = next;
  }
  return combos.filter((c) => Object.keys(c).length > 0);
}

function parseAxisFromUnknown(row: unknown): VariantAxisDef | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const name = String(rec.name ?? rec.optionName ?? rec.property_name ?? "").trim();
  if (!name) return null;
  const rawOpts = rec.values ?? rec.options ?? rec.choices;
  if (!Array.isArray(rawOpts) || rawOpts.length === 0) return null;
  const values: string[] = [];
  const seen = new Set<string>();
  for (const o of rawOpts) {
    const label = optionLabel(o);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(label);
  }
  if (values.length === 0) return null;
  const photosByValue = parsePhotosByValue(rec.photosByValue);
  return {
    name: name.slice(0, 80),
    values,
    ...(photosByValue ? { photosByValue } : {}),
  };
}

function collectSkuOptions(rawOptions: Record<string, unknown>): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawOptions)) {
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) options[name] = val;
  }
  return options;
}

function parseSkuFromUnknown(row: unknown, axes: VariantAxisDef[]): VariantSkuRow | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const rawOptions = asRecord(rec.options);
  if (!rawOptions) return null;
  const collected = collectSkuOptions(rawOptions);
  if (Object.keys(collected).length === 0) return null;
  const options: Record<string, string> = { ...collected };
  for (const axis of axes) {
    const hit =
      collected[axis.name] ??
      Object.entries(collected).find(([k]) => k.trim().toLowerCase() === axis.name.toLowerCase())?.[1];
    const val = hit != null ? String(hit).trim() : "";
    if (!val) return null;
    options[axis.name] = val;
  }
  const photos = optionPhotos(rec);
  const sku = readSku(rec);
  const priceCents = optionPriceCents(rec);
  return {
    options,
    quantity: readQty(rec.quantity),
    ...(priceCents != null ? { priceCents } : {}),
    ...(photos ? { photos } : {}),
    ...(sku ? { sku } : {}),
  };
}

/** Keep option types that still exist on SKU rows even if `axes` was collapsed (e.g. Color-only). */
function inferAxesFromSkus(axes: VariantAxisDef[], skus: VariantSkuRow[]): VariantAxisDef[] {
  const byName = new Map<string, VariantAxisDef>();
  const order: string[] = [];
  const add = (name: string, values: string[], photosByValue?: Record<string, string[]>) => {
    const key = name.trim();
    if (!key) return;
    let axis = byName.get(key);
    if (!axis) {
      const existing = axes.find((a) => a.name.trim().toLowerCase() === key.toLowerCase());
      axis = {
        name: existing?.name ?? key,
        values: [],
        ...(existing?.photosByValue ? { photosByValue: { ...existing.photosByValue } } : {}),
      };
      order.push(axis.name);
      byName.set(axis.name, axis);
      if (axis.name !== key) byName.set(key, axis);
    }
    if (photosByValue) {
      axis.photosByValue = { ...(axis.photosByValue ?? {}), ...photosByValue };
    }
    for (const v of values) {
      const label = v.trim();
      if (!label) continue;
      if (!axis.values.some((x) => x.toLowerCase() === label.toLowerCase())) axis.values.push(label);
    }
  };
  for (const a of axes) add(a.name, a.values, a.photosByValue);
  for (const sku of skus) {
    for (const [name, val] of Object.entries(sku.options)) add(name, [val]);
  }
  return order.map((n) => byName.get(n)).filter((a): a is VariantAxisDef => Boolean(a && a.values.length > 0));
}

function legacyArrayToMatrix(raw: unknown[]): VariantMatrix | null {
  const axes: VariantAxisDef[] = [];
  const optionBags: unknown[][] = [];
  for (const row of raw) {
    const axis = parseAxisFromUnknown(row);
    if (!axis) continue;
    axes.push(axis);
    const rec = asRecord(row);
    const opts = rec?.options ?? rec?.values ?? rec?.choices;
    optionBags.push(Array.isArray(opts) ? opts : []);
  }
  if (axes.length === 0) return null;

  if (axes.length === 1) {
    const skus: VariantSkuRow[] = [];
    for (const o of optionBags[0] ?? []) {
      const value = optionLabel(o);
      if (!value) continue;
      const sku = readSku(o);
      const priceCents = optionPriceCents(o);
      const photos = optionPhotos(o);
      skus.push({
        options: { [axes[0].name]: value },
        quantity: optionQuantity(o) || (typeof o === "string" ? 0 : optionQuantity(o)),
        ...(priceCents != null ? { priceCents } : {}),
        ...(photos ? { photos } : {}),
        ...(sku ? { sku } : {}),
      });
    }
    return { axes, skus };
  }

  const qtyByAxisValue: Map<string, Map<string, number>> = new Map();
  const extraByAxisValue: Map<string, Map<string, { sku?: string; priceCents?: number; photos?: string[] }>> =
    new Map();
  axes.forEach((axis, i) => {
    const qMap = new Map<string, number>();
    const eMap = new Map<string, { sku?: string; priceCents?: number; photos?: string[] }>();
    for (const o of optionBags[i] ?? []) {
      const value = optionLabel(o);
      if (!value) continue;
      qMap.set(value.toLowerCase(), optionQuantity(o));
      eMap.set(value.toLowerCase(), {
        sku: readSku(o),
        priceCents: optionPriceCents(o),
        photos: optionPhotos(o),
      });
    }
    qtyByAxisValue.set(axis.name, qMap);
    extraByAxisValue.set(axis.name, eMap);
  });

  const lastAxis = axes[axes.length - 1];
  const lastQty = qtyByAxisValue.get(lastAxis.name) ?? new Map();
  const skus: VariantSkuRow[] = [];
  for (const options of cartesianOptionMaps(axes)) {
    const lastVal = options[lastAxis.name] ?? "";
    const extra = extraByAxisValue.get(lastAxis.name)?.get(lastVal.toLowerCase());
    skus.push({
      options,
      quantity: lastQty.get(lastVal.toLowerCase()) ?? 0,
      ...(extra?.priceCents != null ? { priceCents: extra.priceCents } : {}),
      ...(extra?.photos ? { photos: extra.photos } : {}),
      ...(extra?.sku ? { sku: extra.sku } : {}),
    });
  }
  return { axes, skus };
}

function withMatrixMeta(matrix: VariantMatrix, obj: Record<string, unknown>): VariantMatrix {
  const imageAxis =
    typeof obj.imageAxis === "string" && obj.imageAxis.trim() ? obj.imageAxis.trim() : matrix.imageAxis;
  const next: VariantMatrix = {
    ...matrix,
    ...(readBoolFlag(obj.pricesVary) != null ? { pricesVary: readBoolFlag(obj.pricesVary) } : {}),
    ...(readBoolFlag(obj.quantitiesVary) != null ? { quantitiesVary: readBoolFlag(obj.quantitiesVary) } : {}),
    ...(readBoolFlag(obj.skusVary) != null ? { skusVary: readBoolFlag(obj.skusVary) } : {}),
    ...(imageAxis != null ? { imageAxis } : {}),
  };
  const inferred = inferMatrixVaryFlags(next);
  return {
    ...next,
    pricesVary: next.pricesVary ?? inferred.pricesVary,
    quantitiesVary: next.quantitiesVary ?? inferred.quantitiesVary,
    skusVary: next.skusVary ?? inferred.skusVary,
    imageAxis: resolveImageAxisName(next),
  };
}

function applyAxisPhotosToMissingSkus(
  matrix: VariantMatrix,
  obj: Record<string, unknown>
): VariantMatrix {
  const imageAxis =
    typeof obj.imageAxis === "string" && obj.imageAxis.trim()
      ? obj.imageAxis.trim()
      : resolveImageAxisName(matrix);
  if (!imageAxis) return matrix;
  return {
    ...matrix,
    imageAxis,
    skus: matrix.skus.map((s) => {
      if (s.photos && s.photos.length > 0) return s;
      const photos = resolveSkuPhotosFromAxes(s.options, matrix.axes, imageAxis);
      return photos?.length ? { ...s, photos } : s;
    }),
  };
}

/** Normalize listing `variants` JSON (matrix object or legacy axis array) to a matrix. */
export function normalizeVariantMatrix(raw: unknown): VariantMatrix | null {
  if (raw == null) return null;

  const obj = asRecord(raw);
  if (obj && Array.isArray(obj.axes)) {
    const axes: VariantAxisDef[] = [];
    for (const a of obj.axes) {
      const parsed = parseAxisFromUnknown(a);
      if (parsed) axes.push(parsed);
    }
    if (axes.length === 0) return null;
    const skus: VariantSkuRow[] = [];
    if (Array.isArray(obj.skus)) {
      for (const row of obj.skus) {
        const sku = parseSkuFromUnknown(row, axes);
        if (sku) skus.push(sku);
      }
    }
    if (skus.length === 0 && Array.isArray(obj.options) === false) {
      // Axes defined but no SKU rows — still a valid structure (all combos omitted).
      return withMatrixMeta({ axes, skus }, obj);
    }
    const inferredAxes = inferAxesFromSkus(axes, skus);
    const withPhotos = applyAxisPhotosToMissingSkus({ axes: inferredAxes, skus }, obj);
    return withMatrixMeta(withPhotos, obj);
  }

  if (Array.isArray(raw) && raw.length > 0) {
    return legacyArrayToMatrix(raw);
  }
  return null;
}

export function serializeVariantMatrix(matrix: VariantMatrix): VariantMatrix {
  const flags = inferMatrixVaryFlags(matrix);
  const imageAxis = resolveImageAxisName(matrix);
  return {
    axes: matrix.axes.map((a) => ({
      name: a.name,
      values: [...a.values],
      ...(a.photosByValue ? { photosByValue: { ...a.photosByValue } } : {}),
    })),
    skus: matrix.skus.map((s) => ({
      options: { ...s.options },
      quantity: Math.max(0, Math.round(s.quantity) || 0),
      ...(flags.pricesVary && s.priceCents != null && s.priceCents > 0
        ? { priceCents: Math.round(s.priceCents) }
        : {}),
      ...(s.photos && s.photos.length > 0 ? { photos: s.photos } : {}),
      ...(flags.skusVary && s.sku?.trim() ? { sku: s.sku.trim() } : {}),
    })),
    pricesVary: flags.pricesVary,
    quantitiesVary: flags.quantitiesVary,
    skusVary: flags.skusVary,
    imageAxis,
  };
}

export function sumMatrixQuantities(matrix: VariantMatrix | null): number {
  if (!matrix) return 0;
  return matrix.skus.reduce((n, s) => n + Math.max(0, s.quantity), 0);
}

export function matrixHasSkuRows(matrix: VariantMatrix | null): boolean {
  return Boolean(matrix && matrix.skus.length > 0);
}

export function pickImageVaryingAxisName(matrix: VariantMatrix): string {
  const pinned = resolveImageAxisName(matrix);
  if (pinned) return pinned;
  const withPhotos = new Set<string>();
  for (const sku of matrix.skus) {
    if (!sku.photos?.length) continue;
    for (const [name, value] of Object.entries(sku.options)) {
      const others = matrix.skus.filter(
        (s) => s.options[name]?.toLowerCase() === value.toLowerCase() && (s.photos?.length ?? 0) > 0
      );
      if (others.length > 0) withPhotos.add(name);
    }
  }
  const color = matrix.axes.find((a) => /color|colour/i.test(a.name));
  if (color && (withPhotos.size === 0 || withPhotos.has(color.name))) return color.name;
  if (withPhotos.size > 0) {
    const named = matrix.axes.find((a) => withPhotos.has(a.name));
    if (named) return named.name;
  }
  return matrix.axes[0]?.name ?? "Option";
}

export function minSkuPriceCents(matrix: VariantMatrix, fallback: number): number {
  const prices = matrix.skus
    .map((s) => s.priceCents)
    .filter((p): p is number => typeof p === "number" && p > 0);
  if (prices.length === 0) return fallback;
  return Math.min(...prices);
}

/** Browse/feed cards: listing price, or “from $X” when SKU overrides differ. */
export function browsePriceLabel(priceCents: number, variants?: unknown): { cents: number; from: boolean } {
  const matrix = normalizeVariantMatrix(variants);
  if (!matrix || matrix.skus.length === 0) return { cents: priceCents, from: false };
  const prices = matrix.skus.map((s) => (s.priceCents && s.priceCents > 0 ? s.priceCents : priceCents));
  const min = Math.min(...prices);
  const distinct = new Set(prices);
  return { cents: min, from: distinct.size > 1 };
}

export function skuPriceCents(sku: VariantSkuRow | null, fallback: number): number {
  if (sku?.priceCents != null && sku.priceCents > 0) return sku.priceCents;
  return fallback;
}

export function skuPhotos(sku: VariantSkuRow | null, listingPhotos: string[]): string[] {
  if (sku?.photos && sku.photos.length > 0) return sku.photos;
  return listingPhotos;
}

export type DisplayVariantOption = { value: string; quantity: number };
export type DisplayVariantAxis = { name: string; options: DisplayVariantOption[] };

/** Axes for buyer pickers: qty is sum of SKUs that include that value. */
export function matrixToDisplayAxes(matrix: VariantMatrix): DisplayVariantAxis[] {
  return matrix.axes.map((axis) => ({
    name: axis.name,
    options: axis.values.map((value) => {
      const quantity = matrix.skus
        .filter((s) => String(s.options[axis.name] ?? "").trim().toLowerCase() === value.toLowerCase())
        .reduce((n, s) => n + Math.max(0, s.quantity), 0);
      return { value, quantity };
    }),
  }));
}

/** Legacy InwVariantAxis-shaped rows (qty summed per value). */
export function matrixToLegacyAxes(matrix: VariantMatrix): {
  name: string;
  options: { value: string; quantity: number; sku?: string }[];
}[] {
  return matrix.axes.map((axis) => ({
    name: axis.name,
    options: axis.values.map((value) => {
      const matching = matrix.skus.filter(
        (s) => String(s.options[axis.name] ?? "").trim().toLowerCase() === value.toLowerCase()
      );
      const quantity = matching.reduce((n, s) => n + Math.max(0, s.quantity), 0);
      const sku = matching.find((s) => s.sku?.trim())?.sku;
      return { value, quantity, ...(sku ? { sku } : {}) };
    }),
  }));
}

export function maxSkuRowsForProviders(providers?: string[] | null): number {
  const set = new Set((providers ?? []).map((p) => p.toLowerCase()));
  if (set.has("shopify")) return MAX_SKU_ROWS_SHOPIFY;
  if (set.has("ebay")) return MAX_SKU_ROWS_EBAY;
  return MAX_SKU_ROWS_DEFAULT;
}

export function validateVariantMatrixForSave(
  raw: unknown,
  opts?: { linkedProviders?: string[] | null }
): string | null {
  if (raw == null) return null;
  const isEmptyArray = Array.isArray(raw) && raw.length === 0;
  const isEmptyObj = asRecord(raw) && !Array.isArray(asRecord(raw)?.axes) && Object.keys(asRecord(raw) ?? {}).length === 0;
  if (isEmptyArray || isEmptyObj) return null;

  const matrix = normalizeVariantMatrix(raw);
  if (!matrix || matrix.axes.length === 0) {
    return "Invalid option format.";
  }
  if (matrix.axes.length > MAX_VARIANT_AXES) {
    return `At most ${MAX_VARIANT_AXES} option types are allowed (for example Size, Color, Material).`;
  }

  const axisNames = new Set<string>();
  for (const axis of matrix.axes) {
    const name = axis.name.trim();
    if (!name) return "Option type name is required (e.g. Size).";
    const key = name.toLowerCase();
    if (axisNames.has(key)) return `Duplicate option type "${axis.name}".`;
    axisNames.add(key);
    if (axis.values.length === 0) return `Option "${axis.name}" has no values.`;
    if (axis.values.length > MAX_VALUES_PER_AXIS) {
      return `At most ${MAX_VALUES_PER_AXIS} values are allowed for "${axis.name}".`;
    }
    const seen = new Set<string>();
    for (const v of axis.values) {
      const vk = v.trim().toLowerCase();
      if (!vk) return "Option values cannot be empty.";
      if (seen.has(vk)) return `Duplicate option value "${v}" on "${axis.name}".`;
      seen.add(vk);
    }
  }

  const maxSkus = maxSkuRowsForProviders(opts?.linkedProviders);
  if (matrix.skus.length > maxSkus) {
    return `At most ${maxSkus} combinations are allowed. Disable unused combinations or reduce option values.`;
  }

  const seenSku = new Set<string>();
  for (const sku of matrix.skus) {
    if (!allMatrixAxesSelected(matrix, sku.options)) {
      return "Each combination must include a value for every option type.";
    }
    const key = skuSelectionKey(sku.options);
    if (seenSku.has(key)) return "Duplicate option combination.";
    seenSku.add(key);
    if (sku.quantity < 0 || !Number.isFinite(sku.quantity)) {
      return "Combination quantities cannot be negative.";
    }
  }
  return null;
}

export function cloneMatrix(matrix: VariantMatrix): VariantMatrix {
  return JSON.parse(JSON.stringify(matrix)) as VariantMatrix;
}

export function decrementMatrixSku(
  matrix: VariantMatrix,
  selection: Record<string, string>,
  by: number
): VariantMatrix | null {
  if (by < 1) return null;
  const next = cloneMatrix(matrix);
  const row = findSkuRow(next, selection);
  if (!row || row.quantity < by) return null;
  row.quantity -= by;
  return next;
}

export function incrementMatrixSku(
  matrix: VariantMatrix,
  selection: Record<string, string>,
  by: number
): VariantMatrix | null {
  if (by < 1) return null;
  const next = cloneMatrix(matrix);
  const row = findSkuRow(next, selection);
  if (!row) return null;
  row.quantity += by;
  return next;
}

export function stampSkuCodes(
  matrix: VariantMatrix,
  updates: { options: Record<string, string>; sku: string }[]
): VariantMatrix {
  const next = cloneMatrix(matrix);
  for (const u of updates) {
    const row = findSkuRow(next, u.options);
    if (row && u.sku.trim()) row.sku = u.sku.trim();
  }
  return next;
}
