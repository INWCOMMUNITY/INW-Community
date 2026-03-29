/**
 * Resolve business images for display. Uses the same API origin as `apiGet` so relative
 * `/uploads/...` paths match the working business detail screen.
 * siteBase is computed per call so `API_BASE` is always read after `api` finishes initializing.
 */

import { API_BASE } from "./api";

function siteBaseFromApi(): string {
  return API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
}

/** Wix gallery URLs often include `/v1/fill/...` transforms; strip to the stable media URL. */
export function wixOriginalMediaUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("static.wixstatic.com/media")) return url;
  const v1 = url.indexOf("/v1/");
  if (v1 === -1) return url;
  return url.slice(0, v1);
}

/**
 * Absolute URI for a stored logo/gallery/cover path.
 * Matches `resolveUrl` in `app/business/[slug].tsx`, plus trim, protocol-relative URLs, and Wix cleanup.
 */
export function resolveBusinessLogoDisplayUri(path: string | null | undefined): string | undefined {
  const raw = typeof path === "string" ? path.trim() : "";
  if (!raw) return undefined;
  let u = wixOriginalMediaUrl(raw);
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("file:")) {
    return u;
  }
  const siteBase = siteBaseFromApi();
  return `${siteBase}${u.startsWith("/") ? "" : "/"}${u}`;
}

/** Optional headers so image CDNs / WAFs that expect a browser-like request still deliver the asset. */
export function businessImageRequestHeaders(): Record<string, string> | undefined {
  if (API_BASE.includes("inwcommunity.com")) {
    return {
      Referer: "https://www.inwcommunity.com/",
    };
  }
  return undefined;
}

/** Prefer logo from the edit form, then cover photo, then first gallery image. */
export function hubBusinessHeroImageUri(b: {
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  photos?: string[] | null;
}): string | undefined {
  return (
    resolveBusinessLogoDisplayUri(b.logoUrl) ??
    resolveBusinessLogoDisplayUri(b.coverPhotoUrl ?? null) ??
    resolveBusinessLogoDisplayUri(b.photos?.[0] ?? null)
  );
}
