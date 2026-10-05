/**
 * Map Etsy Shop Manager Attributes (+ materials / dimensions) into INW Item Details.
 * Etsy→INW only — StoreItem.aspects stay ignored by Etsy outbound adapters.
 */

export type EtsyInboundAspect = { name: string; value: string };

const ASPECT_NAME_MAX = 40;
const ASPECT_VALUE_MAX = 50;
const MAX_ASPECTS = 30;

export function normalizeInboundAspects(raw: unknown): EtsyInboundAspect[] {
  if (!Array.isArray(raw)) return [];
  const out: EtsyInboundAspect[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { name?: unknown; value?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, ASPECT_NAME_MAX) : "";
    const value =
      typeof rec.value === "string" ? rec.value.trim().slice(0, ASPECT_VALUE_MAX) : "";
    if (!name || !value) continue;
    const key = `${name.toLowerCase()}\u0000${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, value });
    if (out.length >= MAX_ASPECTS) break;
  }
  return out;
}

export type EtsyListingAttributeSource = {
  properties?: Array<{
    property_name?: string | null;
    scale_name?: string | null;
    values?: string[] | null;
  }> | null;
  materials?: string[] | null;
  itemWidth?: number | null;
  itemHeight?: number | null;
  itemLength?: number | null;
  itemDimensionsUnit?: string | null;
};

function dimensionValue(amount: number | null | undefined, unit: string | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return "";
  const u = typeof unit === "string" ? unit.trim() : "";
  const num = Number.isInteger(amount) ? String(amount) : String(amount);
  return u ? `${num} ${u}` : num;
}

/** Build Item Details rows from Etsy listing properties, materials, and dimensions. */
export function buildEtsyInboundAspects(source: EtsyListingAttributeSource): EtsyInboundAspect[] {
  const rows: EtsyInboundAspect[] = [];
  for (const property of source.properties ?? []) {
    const name = String(property.property_name ?? "").trim();
    if (!name) continue;
    const values = (property.values ?? [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    const scale = String(property.scale_name ?? "").trim();
    const joined = values.join(", ");
    rows.push({
      name,
      value: scale && !joined.toLowerCase().includes(scale.toLowerCase()) ? `${joined} (${scale})` : joined,
    });
  }

  const materials = (source.materials ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (materials.length > 0 && !rows.some((row) => row.name.toLowerCase() === "materials")) {
    rows.push({ name: "Materials", value: materials.join(", ") });
  }

  const unit = source.itemDimensionsUnit ?? null;
  const width = dimensionValue(source.itemWidth, unit);
  const height = dimensionValue(source.itemHeight, unit);
  const length = dimensionValue(source.itemLength, unit);
  if (width && !rows.some((row) => row.name.toLowerCase() === "width")) {
    rows.push({ name: "Width", value: width });
  }
  if (height && !rows.some((row) => row.name.toLowerCase() === "height")) {
    rows.push({ name: "Height", value: height });
  }
  if (length && !rows.some((row) => row.name.toLowerCase() === "depth" || row.name.toLowerCase() === "length")) {
    rows.push({ name: "Depth", value: length });
  }

  return normalizeInboundAspects(rows);
}

/**
 * Etsy attribute names replace matching local descriptors.
 * Local-only descriptors (e.g. Brand added on INW) are kept.
 */
export function mergeEtsyInboundAspects(
  local: unknown,
  remote: EtsyInboundAspect[]
): EtsyInboundAspect[] {
  const localRows = normalizeInboundAspects(local);
  if (remote.length === 0) return localRows;
  const remoteNames = new Set(remote.map((row) => row.name.toLowerCase()));
  const keptLocal = localRows.filter((row) => !remoteNames.has(row.name.toLowerCase()));
  return normalizeInboundAspects([...remote, ...keptLocal]);
}

export function aspectsEqual(a: unknown, b: unknown): boolean {
  const left = normalizeInboundAspects(a);
  const right = normalizeInboundAspects(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i]!.name !== right[i]!.name || left[i]!.value !== right[i]!.value) return false;
  }
  return true;
}

export function normalizeEtsyTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const tag = String(entry ?? "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag.slice(0, 80));
    if (out.length >= 13) break;
  }
  return out;
}

export function tagsEqual(a: unknown, b: unknown): boolean {
  const left = normalizeEtsyTags(a);
  const right = normalizeEtsyTags(b);
  if (left.length !== right.length) return false;
  return left.every((tag, i) => tag.toLowerCase() === right[i]!.toLowerCase());
}
