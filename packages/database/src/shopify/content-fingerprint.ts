import { createHash } from "crypto";

/** Convert integer minor units to Shopify money decimal string without float error. */
export function shopifyMoneyFromCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, Math.trunc(cents)) : 0;
  return (safe / 100).toFixed(2);
}

/** Parse Shopify Money/Decimal string into integer cents. Returns NaN if invalid. */
export function shopifyCentsFromMoneyString(price: string): number {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(String(price).trim());
  if (!match) return Number.NaN;
  const dollars = Number.parseInt(match[1], 10);
  const cents = Number.parseInt((match[2] || "").padEnd(2, "0").slice(0, 2) || "0", 10);
  return dollars * 100 + cents;
}

export function normalizeShopifySku(sku: string | null | undefined): string {
  return typeof sku === "string" ? sku.trim() : "";
}

export function normalizeShopifyTitle(title: string | null | undefined): string {
  return typeof title === "string" ? title.trim() : "";
}

export function normalizeShopifyDescription(description: string | null | undefined): string {
  return typeof description === "string" ? description : "";
}

export function normalizeShopifyVendor(vendor: string | null | undefined): string {
  return typeof vendor === "string" ? vendor.trim() : "";
}

export function normalizeShopifyBarcode(barcode: string | null | undefined): string {
  return typeof barcode === "string" ? barcode.trim() : "";
}

export function normalizeShopifyTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function normalizeShopifyPhotoUrls(photos: string[] | null | undefined): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of photos) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function normalizeShopifyAspects(aspects: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(aspects)) return [];
  const rows: Array<{ name: string; value: string }> = [];
  for (const entry of aspects) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const value =
      typeof rec.value === "string"
        ? rec.value.trim()
        : rec.value != null
          ? String(rec.value).trim()
          : "";
    if (!name || !value) continue;
    rows.push({ name, value });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value));
}

function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Product content fingerprint: title, description, photos, vendor, tags, aspects. */
export function shopifyProductContentFingerprint(input: {
  title: string | null | undefined;
  description: string | null | undefined;
  photos?: string[] | null | undefined;
  vendor?: string | null | undefined;
  tags?: string[] | null | undefined;
  aspects?: unknown;
}): string {
  const payload = {
    title: normalizeShopifyTitle(input.title),
    description: normalizeShopifyDescription(input.description),
    photos: normalizeShopifyPhotoUrls(input.photos),
    vendor: normalizeShopifyVendor(input.vendor),
    tags: normalizeShopifyTags(input.tags),
    aspects: normalizeShopifyAspects(input.aspects),
  };
  return sha256Hex(JSON.stringify(payload));
}

/** Variant content fingerprint: price, SKU, barcode, compare-at. */
export function shopifyVariantContentFingerprint(input: {
  priceCents: number;
  sku: string | null | undefined;
  barcode?: string | null | undefined;
  compareAtPriceCents?: number | null | undefined;
}): string {
  const payload = {
    price: shopifyMoneyFromCents(input.priceCents),
    sku: normalizeShopifySku(input.sku),
    barcode: normalizeShopifyBarcode(input.barcode),
    compareAtPrice:
      typeof input.compareAtPriceCents === "number" && Number.isFinite(input.compareAtPriceCents)
        ? shopifyMoneyFromCents(input.compareAtPriceCents)
        : "",
  };
  return sha256Hex(JSON.stringify(payload));
}

export function shopifyUpdateListingContentDedupeKey(input: {
  connectionId: string;
  storeItemId: string;
  storeVariantId?: string;
  productDesiredVersion: number;
  variantDesiredVersion: number;
}): string {
  const variantPart = input.storeVariantId?.trim()
    ? `${input.storeVariantId.trim()}:`
    : "";
  return `UPDATE_LISTING_CONTENT:${input.connectionId}:${input.storeItemId}:${variantPart}p${input.productDesiredVersion}:v${input.variantDesiredVersion}`;
}
