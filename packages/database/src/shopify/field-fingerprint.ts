import { createHash } from "crypto";
import {
  normalizeShopifyAspects,
  normalizeShopifyBarcode,
  normalizeShopifyDescription,
  normalizeShopifySku,
  normalizeShopifyTags,
  normalizeShopifyTitle,
  normalizeShopifyVendor,
  shopifyMoneyFromCents,
} from "./content-fingerprint";
import type { ShopifyAdaptiveFieldKey } from "./field-semantic";

function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Stable per-field fingerprint. Empty string fingerprints are valid (cleared field). */
export function shopifyFieldFingerprint(
  field: ShopifyAdaptiveFieldKey,
  value: unknown
): string {
  switch (field) {
    case "TITLE":
      return sha256Hex(JSON.stringify({ title: normalizeShopifyTitle(value as string) }));
    case "DESCRIPTION":
      return sha256Hex(
        JSON.stringify({ description: normalizeShopifyDescription(value as string | null) })
      );
    case "MEDIA": {
      // Durable identity list (inwMediaId[]) preferred; URL arrays accepted as transitional.
      const rows = Array.isArray(value)
        ? value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean)
        : [];
      return sha256Hex(JSON.stringify({ media: rows }));
    }
    case "VENDOR":
      return sha256Hex(JSON.stringify({ vendor: normalizeShopifyVendor(value as string | null) }));
    case "TAGS":
      return sha256Hex(JSON.stringify({ tags: normalizeShopifyTags(value as string[] | null) }));
    case "ASPECTS":
      return sha256Hex(JSON.stringify({ aspects: normalizeShopifyAspects(value) }));
    case "PRICE": {
      const cents = typeof value === "number" ? value : Number(value);
      return sha256Hex(JSON.stringify({ price: shopifyMoneyFromCents(cents) }));
    }
    case "SKU":
      return sha256Hex(JSON.stringify({ sku: normalizeShopifySku(value as string | null) }));
    case "BARCODE":
      return sha256Hex(
        JSON.stringify({ barcode: normalizeShopifyBarcode(value as string | null) })
      );
    case "COMPARE_AT": {
      if (value == null || value === "") {
        return sha256Hex(JSON.stringify({ compareAtPrice: "" }));
      }
      const cents = typeof value === "number" ? value : Number(value);
      return sha256Hex(
        JSON.stringify({
          compareAtPrice: Number.isFinite(cents) ? shopifyMoneyFromCents(cents) : "",
        })
      );
    }
  }
}

/** Normalize description HTML for equivalence (avoid ping-pong on whitespace/serialization). */
export function normalizeShopifyDescriptionHtmlForCompare(
  html: string | null | undefined
): string {
  const raw = normalizeShopifyDescription(html);
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function shopifyDescriptionFieldFingerprint(html: string | null | undefined): string {
  return sha256Hex(
    JSON.stringify({ description: normalizeShopifyDescriptionHtmlForCompare(html) })
  );
}
