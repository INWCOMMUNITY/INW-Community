const SECRET_PATTERNS: RegExp[] = [
  /shpat_[A-Za-z0-9_]+/g,
  /shprt_[A-Za-z0-9_]+/g,
  /shpss_[A-Za-z0-9_]+/g,
  /shpua_[A-Za-z0-9_]+/g,
];

/** Strip Shopify token-shaped secrets from a string before it can be logged or returned. */
export function redactShopifySecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}
