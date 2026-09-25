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

function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Product content fingerprint: title + description only. */
export function shopifyProductContentFingerprint(input: {
  title: string | null | undefined;
  description: string | null | undefined;
}): string {
  const payload = {
    title: normalizeShopifyTitle(input.title),
    description: normalizeShopifyDescription(input.description),
  };
  return sha256Hex(JSON.stringify(payload));
}

/** Variant content fingerprint: price (Shopify decimal) + SKU only. */
export function shopifyVariantContentFingerprint(input: {
  priceCents: number;
  sku: string | null | undefined;
}): string {
  const payload = {
    price: shopifyMoneyFromCents(input.priceCents),
    sku: normalizeShopifySku(input.sku),
  };
  return sha256Hex(JSON.stringify(payload));
}

export function shopifyUpdateListingContentDedupeKey(input: {
  connectionId: string;
  storeItemId: string;
  productDesiredVersion: number;
  variantDesiredVersion: number;
}): string {
  return `UPDATE_LISTING_CONTENT:${input.connectionId}:${input.storeItemId}:p${input.productDesiredVersion}:v${input.variantDesiredVersion}`;
}
