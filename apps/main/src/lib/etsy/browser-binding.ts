import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { ETSY_OAUTH_STATE_TTL_MS } from "./constants";

export const ETSY_OAUTH_BROWSER_COOKIE = "etsy_oauth_browser";

/**
 * Path controls which future requests receive the cookie (RFC 6265).
 * Callback is the only reader, so Path is scoped to the callback route.
 */
export const ETSY_OAUTH_BROWSER_COOKIE_PATH = "/api/etsy/oauth/callback";

export function createEtsyBrowserBindingSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashEtsyBrowserBinding(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function etsyBrowserBindingMatches(storedHash: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(storedHash) || !secret) return false;
  const actual = hashEtsyBrowserBinding(secret);
  const left = Buffer.from(storedHash, "hex");
  const right = Buffer.from(actual, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function etsyBrowserBindingCookie(secret: string) {
  return {
    name: ETSY_OAUTH_BROWSER_COOKIE,
    value: secret,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: ETSY_OAUTH_BROWSER_COOKIE_PATH,
      maxAge: Math.floor(ETSY_OAUTH_STATE_TTL_MS / 1000),
    },
  };
}

export function clearedEtsyBrowserBindingCookie() {
  return {
    name: ETSY_OAUTH_BROWSER_COOKIE,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: ETSY_OAUTH_BROWSER_COOKIE_PATH,
      maxAge: 0,
    },
  };
}
