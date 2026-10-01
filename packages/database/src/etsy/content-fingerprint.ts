import { createHash } from "crypto";

export function normalizeEtsyTitle(title: string | null | undefined): string {
  return typeof title === "string" ? title.trim() : "";
}

export function normalizeEtsyDescription(description: string | null | undefined): string {
  return typeof description === "string" ? description : "";
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

export function etsyCentsFromMoney(input: {
  amount?: number | null;
  divisor?: number | null;
  price?: number | string | null;
}): number {
  if (typeof input.amount === "number" && Number.isFinite(input.amount)) {
    const divisor =
      typeof input.divisor === "number" && Number.isFinite(input.divisor) && input.divisor > 0
        ? input.divisor
        : 100;
    return Math.round((input.amount / divisor) * 100);
  }
  if (typeof input.price === "number" && Number.isFinite(input.price)) {
    return Math.round(input.price * 100);
  }
  if (typeof input.price === "string") {
    const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(input.price.trim());
    if (!match) return Number.NaN;
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
  photos?: string[] | null | undefined;
}): string {
  const payload = {
    title: normalizeEtsyTitle(input.title),
    description: normalizeEtsyDescription(input.description),
    photos: normalizeEtsyPhotoUrls(input.photos),
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
