/**
 * Turn stored member media paths into absolute URLs for web and email clients.
 */
export function resolveMemberMediaUrl(url: string | null | undefined, baseUrl?: string): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = (baseUrl ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  if (!base) return url.startsWith("/") ? url : `/${url}`;
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}
