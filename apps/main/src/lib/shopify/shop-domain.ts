import { SHOPIFY_SHOP_DOMAIN_PATTERN } from "./constants";

const MAX_INPUT_LENGTH = 2048;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isCanonicalShopifyHostname(hostname: string): boolean {
  if (!SHOPIFY_SHOP_DOMAIN_PATTERN.test(hostname)) return false;
  const label = hostname.slice(0, -".myshopify.com".length);
  if (!label || label.startsWith("-") || label.endsWith("-")) return false;
  if (label.includes("..") || label.includes(".-") || label.includes("-.")) return false;
  return true;
}

/**
 * Extract a candidate hostname from seller input.
 * URL-shaped values are parsed with the URL constructor; bare hostnames are returned as-is.
 * Returns null on malformed / disallowed URL shapes (credentials, bad scheme, explicit port).
 */
function extractHostnameCandidate(trimmed: string): string | null {
  const looksLikeUrl =
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes("@");

  if (!looksLikeUrl) {
    return trimmed;
  }

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) {
    return null;
  }

  let toParse = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(toParse)) {
    toParse = `https://${toParse}`;
  }

  let url: URL;
  try {
    url = new URL(toParse);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // Reject unexpected non-default ports (default http/https ports appear as "").
  if (url.port) return null;
  if (!url.hostname) return null;

  return url.hostname;
}

/**
 * Canonicalize seller shop input to a durable `*.myshopify.com` hostname.
 * Accepts bare hostnames, http(s) store URLs, and Shopify Admin URLs.
 * Rejects custom domains, suffix tricks, credentials, and non-http(s) schemes.
 */
export function normalizeShopifyShopDomain(input: string): string | null {
  if (typeof input !== "string") return null;
  if (CONTROL_CHARS.test(input)) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return null;

  let hostname = extractHostnameCandidate(trimmed);
  if (!hostname) return null;

  hostname = hostname.toLowerCase();
  if (hostname.endsWith(".")) {
    hostname = hostname.slice(0, -1);
  }

  // Optional bare store handle → permanent domain (UI still documents *.myshopify.com).
  if (!hostname.includes(".")) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(hostname) || hostname.length > 63) return null;
    hostname = `${hostname}.myshopify.com`;
  }

  if (hostname.includes("..") || hostname.startsWith("-") || hostname.includes(".-") || hostname.includes("-.")) {
    return null;
  }
  if (!isCanonicalShopifyHostname(hostname)) return null;
  return hostname;
}
