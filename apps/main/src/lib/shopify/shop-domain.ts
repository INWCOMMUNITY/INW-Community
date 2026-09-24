import { SHOPIFY_SHOP_DOMAIN_PATTERN } from "./constants";

/**
 * Accept only a canonical `*.myshopify.com` hostname.
 * Rejects protocol, path, query, port, and arbitrary domains.
 */
export function normalizeShopifyShopDomain(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.length > 255) return null;
  if (/[\s\/\\?#@:]/.test(trimmed)) return null;
  if (trimmed.includes("..") || trimmed.startsWith("-") || trimmed.includes(".-") || trimmed.includes("-.")) {
    return null;
  }
  if (!SHOPIFY_SHOP_DOMAIN_PATTERN.test(trimmed)) return null;
  const label = trimmed.slice(0, -".myshopify.com".length);
  if (!label || label.startsWith("-") || label.endsWith("-")) return null;
  return trimmed;
}
