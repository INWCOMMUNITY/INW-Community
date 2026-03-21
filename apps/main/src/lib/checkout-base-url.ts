import { getBaseUrl } from "@/lib/get-base-url";

/**
 * Resolves the base URL for Stripe success/cancel redirects.
 * Ignores client-supplied values that are not same-origin as the app or listed in
 * CHECKOUT_ALLOWED_BASE_URLS (comma-separated origins or full base URLs, e.g. http://192.168.1.5:3000).
 */
export function resolveAllowedCheckoutBaseUrl(requested?: string | null): string {
  const fallback = getBaseUrl().replace(/\/+$/, "");
  if (!requested || typeof requested !== "string") return fallback;
  const trimmed = requested.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return fallback;

  let requestedOrigin: string;
  let fallbackOrigin: string;
  try {
    requestedOrigin = new URL(trimmed).origin;
    const fallbackForParse = /^https?:\/\//i.test(fallback) ? fallback : `https://${fallback}`;
    fallbackOrigin = new URL(fallbackForParse).origin;
  } catch {
    return fallback;
  }

  if (requestedOrigin === fallbackOrigin) return trimmed;

  const extras = (process.env.CHECKOUT_ALLOWED_BASE_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of extras) {
    try {
      const normalized = /^https?:\/\//i.test(entry)
        ? entry.replace(/\/+$/, "")
        : `https://${entry.replace(/\/+$/, "")}`;
      if (new URL(normalized).origin === requestedOrigin) return trimmed;
    } catch {
      continue;
    }
  }

  return fallback;
}
