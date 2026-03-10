/**
 * Resolves the site base URL for redirects (e.g. Stripe return_url, order-success).
 * Order: NEXTAUTH_URL → VERCEL_URL (https) → production default → localhost.
 * Use this so checkout and other redirects work when NEXTAUTH_URL is unset in production.
 */
export function getBaseUrl(): string {
  const nextAuth = process.env.NEXTAUTH_URL?.trim();
  if (nextAuth) return nextAuth.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").split("/")[0]}`;
  return process.env.NODE_ENV === "production" ? "https://www.inwcommunity.com" : "http://localhost:3000";
}
