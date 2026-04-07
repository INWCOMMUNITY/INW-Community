/**
 * Canonical HTTPS origin for links in emails and redirects (no trailing slash).
 */
export function getPublicSiteOrigin(): string {
  const vercel =
    typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL.trim()
      ? `https://${process.env.VERCEL_URL.trim()}`
      : "";
  const raw =
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_MAIN_SITE_URL?.trim() ||
    vercel;
  if (raw) {
    try {
      const withProto = raw.includes("://") ? raw : `https://${raw}`;
      return new URL(withProto).origin.replace(/\/+$/, "");
    } catch {
      /* fall through */
    }
  }
  return "https://www.inwcommunity.com";
}
