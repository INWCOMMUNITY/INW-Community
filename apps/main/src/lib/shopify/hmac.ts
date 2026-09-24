import { createHmac, timingSafeEqual } from "crypto";

function safeEqualHex(expectedHex: string, providedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(providedHex) || expectedHex.length !== providedHex.length) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(providedHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function safeEqualBase64(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * OAuth callback HMAC: hex SHA-256 of the sorted query string excluding `hmac`.
 * https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps
 */
export function verifyShopifyOAuthHmac(
  params: Record<string, string>,
  clientSecret: string
): boolean {
  const hmac = params.hmac;
  if (!hmac || !clientSecret) return false;
  const message = Object.entries(params)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  return safeEqualHex(digest, hmac);
}

/** Webhook HMAC: base64 SHA-256 of the raw body. */
export function verifyShopifyWebhookHmac(
  rawBody: string,
  headerHmac: string | null,
  clientSecret: string
): boolean {
  if (!headerHmac || !clientSecret) return false;
  const digest = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64");
  return safeEqualBase64(digest, headerHmac);
}
