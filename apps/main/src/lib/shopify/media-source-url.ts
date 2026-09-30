/**
 * Resolve INW photo URLs into publicly fetchable absolute URLs for Shopify productCreateMedia.
 * Shopify cannot fetch relative paths or localhost.
 */

function mediaOriginBase(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SHOPIFY_APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.APP_URL,
  ];
  for (const raw of candidates) {
    const trimmed = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed);
      if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.host}`;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".local")) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

export type ResolveShopifyMediaSourceUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: "MEDIA_URL_INVALID" | "MEDIA_URL_NOT_PUBLIC"; message: string };

export function resolveShopifyMediaSourceUrl(raw: string): ResolveShopifyMediaSourceUrlResult {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    return { ok: false, code: "MEDIA_URL_INVALID", message: "Empty media URL" };
  }

  let absolute = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    const base = mediaOriginBase();
    if (!base) {
      return {
        ok: false,
        code: "MEDIA_URL_NOT_PUBLIC",
        message: "Relative media URL cannot be absolutized; set NEXT_PUBLIC_APP_URL",
      };
    }
    absolute = trimmed.startsWith("/") ? `${base}${trimmed}` : `${base}/${trimmed}`;
  }

  try {
    const u = new URL(absolute);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, code: "MEDIA_URL_INVALID", message: `Unsupported media URL protocol ${u.protocol}` };
    }
    if (isPrivateOrLocalHost(u.hostname)) {
      return {
        ok: false,
        code: "MEDIA_URL_NOT_PUBLIC",
        message: `Shopify cannot fetch media from private host ${u.hostname}`,
      };
    }
    return { ok: true, url: u.toString() };
  } catch {
    return { ok: false, code: "MEDIA_URL_INVALID", message: "Media URL is not a valid absolute URL" };
  }
}

/** Absolutize photo list; fails fast on first unusable URL. */
export function resolveShopifyMediaSourceUrls(
  photos: string[] | null | undefined
):
  | { ok: true; urls: string[] }
  | { ok: false; code: "MEDIA_URL_INVALID" | "MEDIA_URL_NOT_PUBLIC"; message: string } {
  if (!Array.isArray(photos) || photos.length < 1) return { ok: true, urls: [] };
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    if (typeof photo !== "string" || !photo.trim()) continue;
    const resolved = resolveShopifyMediaSourceUrl(photo);
    if (!resolved.ok) return resolved;
    if (seen.has(resolved.url)) continue;
    seen.add(resolved.url);
    urls.push(resolved.url);
  }
  return { ok: true, urls };
}
