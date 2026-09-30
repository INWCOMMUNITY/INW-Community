import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { SHOPIFY_OAUTH_STATE_TTL_MS } from "./constants";

export const SHOPIFY_OAUTH_BROWSER_COOKIE = "shopify_oauth_browser";

/**
 * Path controls which future requests receive the cookie (RFC 6265).
 * Callback is the only reader, so Path is scoped to the callback route.
 * A connect response may legally Set-Cookie with this Path (storage does not
 * require Path to match the setting request-URI).
 */
export const SHOPIFY_OAUTH_BROWSER_COOKIE_PATH = "/api/shopify/oauth/callback";

export function createShopifyBrowserBindingSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashShopifyBrowserBinding(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function shopifyBrowserBindingMatches(storedHash: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(storedHash) || !secret) return false;
  const actual = hashShopifyBrowserBinding(secret);
  const left = Buffer.from(storedHash, "hex");
  const right = Buffer.from(actual, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** RFC 6265 path-match for which requests SEND an already-stored cookie. */
export function shopifyBrowserCookiePathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith("/")) return true;
  return requestPath.charAt(cookiePath.length) === "/";
}

export function shopifyBrowserBindingCookie(secret: string) {
  return {
    name: SHOPIFY_OAUTH_BROWSER_COOKIE,
    value: secret,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: SHOPIFY_OAUTH_BROWSER_COOKIE_PATH,
      maxAge: Math.floor(SHOPIFY_OAUTH_STATE_TTL_MS / 1000),
      // host-only: no Domain attribute
    },
  };
}

export function clearedShopifyBrowserBindingCookie() {
  return {
    name: SHOPIFY_OAUTH_BROWSER_COOKIE,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: SHOPIFY_OAUTH_BROWSER_COOKIE_PATH,
      maxAge: 0,
    },
  };
}
