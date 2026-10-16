import { createHash } from "crypto";
import { listingDescriptionPlainText } from "../listing-description-plain";

export function normalizeEtsyTitle(title: string | null | undefined): string {
  return typeof title === "string" ? title.trim() : "";
}

/** Stable description compare/write for INW↔Etsy. HTML wrappers become plain text. */
export function normalizeEtsyDescription(description: string | null | undefined): string {
  return listingDescriptionPlainText(description);
}

export function normalizeEtsySku(sku: string | null | undefined): string {
  return typeof sku === "string" ? sku.trim() : "";
}

export function normalizeEtsyPhotoUrls(photos: string[] | null | undefined): string[] {
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

/** Convert integer cents to Etsy money amount/divisor pair. */
export function etsyMoneyFromCents(cents: number): { amount: number; divisor: number; currency_code: string } {
  const safe = Number.isFinite(cents) ? Math.max(0, Math.trunc(cents)) : 0;
  return { amount: safe, divisor: 100, currency_code: "USD" };
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function etsyCentsFromMoney(input: {
  amount?: number | string | null;
  divisor?: number | string | null;
  price?: number | string | null;
}): number {
  const amount = coerceFiniteNumber(input.amount);
  if (amount != null) {
    const divisorRaw = coerceFiniteNumber(input.divisor);
    const divisor = divisorRaw != null && divisorRaw > 0 ? divisorRaw : 100;
    return Math.round((amount / divisor) * 100);
  }
  const priceNumber = coerceFiniteNumber(input.price);
  if (priceNumber != null && typeof input.price !== "string") {
    return Math.round(priceNumber * 100);
  }
  if (typeof input.price === "string") {
    const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(input.price.trim());
    if (!match) {
      // Fall back to Number() for values like "12.5" / "12.50" already handled; keep NaN otherwise.
      return priceNumber != null ? Math.round(priceNumber * 100) : Number.NaN;
    }
    const dollars = Number.parseInt(match[1], 10);
    const cents = Number.parseInt((match[2] || "").padEnd(2, "0").slice(0, 2) || "0", 10);
    return dollars * 100 + cents;
  }
  return Number.NaN;
}

function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function etsyProductContentFingerprint(input: {
  title: string | null | undefined;
  description: string | null | undefined;
  /** Accepted for call-site compatibility; ignored until durable Etsy media mapping exists. */
  photos?: string[] | null | undefined;
}): string {
  // Photos are intentionally omitted: INW URLs never equal Etsy CDN URLs, so including
  // them caused permanent CONTENT_CONFLICT / blocked title sync after every photo desire.
  void input.photos;
  const payload = {
    title: normalizeEtsyTitle(input.title),
    description: normalizeEtsyDescription(input.description),
  };
  return sha256Hex(JSON.stringify(payload));
}

export function etsyVariantContentFingerprint(input: {
  priceCents: number;
  sku: string | null | undefined;
}): string {
  const payload = {
    priceCents: Number.isFinite(input.priceCents) ? Math.trunc(input.priceCents) : 0,
    sku: normalizeEtsySku(input.sku),
  };
  return sha256Hex(JSON.stringify(payload));
}

export function etsyUpdateListingContentDedupeKey(input: {
  connectionId: string;
  storeItemId: string;
  storeVariantId?: string;
  productDesiredVersion: number;
  variantDesiredVersion: number;
}): string {
  const variantPart = input.storeVariantId?.trim() ? `${input.storeVariantId.trim()}:` : "";
  return `UPDATE_LISTING_CONTENT:${input.connectionId}:${input.storeItemId}:${variantPart}p${input.productDesiredVersion}:v${input.variantDesiredVersion}`;
}
