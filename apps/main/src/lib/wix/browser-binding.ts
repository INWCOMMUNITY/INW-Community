import { createHash, randomBytes } from "crypto";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

const WIX_BROWSER_BINDING_COOKIE_NAME = "wix_oauth_binding";
const WIX_BROWSER_BINDING_COOKIE_MAX_AGE = 10 * 60; // 10 minutes

/**
 * Create a cryptographically random browser binding secret.
 */
export function createWixBrowserBindingSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash the browser binding secret for storage in the database.
 */
export function hashWixBrowserBinding(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Check if a provided secret matches the stored hash.
 */
export function wixBrowserBindingMatches(storedHash: string, providedSecret: string): boolean {
  const providedHash = hashWixBrowserBinding(providedSecret);
  // Constant-time comparison
  if (storedHash.length !== providedHash.length) return false;
  let result = 0;
  for (let i = 0; i < storedHash.length; i++) {
    result |= storedHash.charCodeAt(i) ^ providedHash.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Create a browser binding cookie for the OAuth flow.
 */
export function wixBrowserBindingCookie(secret: string): {
  name: string;
  value: string;
  options: Partial<ResponseCookie>;
} {
  const isSecure = process.env.NODE_ENV === "production";
  return {
    name: WIX_BROWSER_BINDING_COOKIE_NAME,
    value: secret,
    options: {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/api/wix",
      maxAge: WIX_BROWSER_BINDING_COOKIE_MAX_AGE,
    },
  };
}

/**
 * Get the browser binding cookie name.
 */
export function getWixBrowserBindingCookieName(): string {
  return WIX_BROWSER_BINDING_COOKIE_NAME;
}
