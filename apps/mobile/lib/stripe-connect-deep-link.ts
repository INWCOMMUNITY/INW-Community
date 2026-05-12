/**
 * Stripe Connect onboarding completes in the browser/WebView; the site redirects here so we can
 * open the native app via custom scheme (see apps/main/src/app/app/stripe-connect-return).
 */

export const STRIPE_CONNECT_RETURN_SCHEME = "inwcommunity://stripe-connect-return";

export function parseStripeConnectReturnUrl(url: string): string | null {
  if (!url.startsWith(STRIPE_CONNECT_RETURN_SCHEME)) return null;
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const path = new URLSearchParams(q).get("path") ?? "/seller-hub";
  if (!path.startsWith("/") || path.includes("..") || path.includes("//")) {
    return "/seller-hub";
  }
  if (!/^\/(seller-hub|resale-hub)(\/|$)/.test(path)) {
    return "/seller-hub";
  }
  return path.split("?")[0]?.split("#")[0] ?? "/seller-hub";
}
