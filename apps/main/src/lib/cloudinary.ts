/** Cloud name - use NEXT_PUBLIC_ for client-safe usage (no cloudinary SDK, avoids fs in browser) */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

/** Public ID of thanks-landscape when uploaded to Cloudinary. Set in Vercel to use high-res delivery. */
const thanksImagePublicId = process.env.NEXT_PUBLIC_CLOUDINARY_THANKS_IMAGE;

/** Public ID of directory background when uploaded to Cloudinary (e.g. background_lv6evz). */
const directoryBackgroundPublicId =
  process.env.NEXT_PUBLIC_CLOUDINARY_DIRECTORY_BACKGROUND ?? "background_lv6evz";

function getBaseUrl(): string {
  const v = process.env.VERCEL_URL;
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (v ? `https://${v}` : undefined) ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  );
}

/**
 * Proxy image URLs through Cloudinary for higher resolution and optimization.
 * Relative URLs are returned as-is unless proxyRelative: true (needs allowed fetch domain in Cloudinary).
 */
export function cloudinaryFetchUrl(
  sourceUrl: string,
  options: {
    width?: number;
    quality?: "auto" | "auto:best" | "auto:good" | number;
    /** When true, proxy relative URLs (e.g. /thanks-landscape.png) through Cloudinary. Requires your domain in Cloudinary allowed fetch list. */
    proxyRelative?: boolean;
  } = {}
): string {
  if (!cloudName || !sourceUrl) return sourceUrl ?? "";
  let absUrl = sourceUrl;
  if (sourceUrl.startsWith("/")) {
    if (!options.proxyRelative) return sourceUrl;
    const base = getBaseUrl();
    const isLocalhost = /^https?:\/\/localhost(:\d+)?(\/|$)/i.test(base) || base.includes("127.0.0.1");
    if (isLocalhost) return sourceUrl;
    absUrl = `${base.replace(/\/$/, "")}${sourceUrl}`;
  }
  const enc = encodeURIComponent(absUrl);
  const parts: string[] = ["f_auto", "q_auto:best"];
  if (options.width) parts.push(`w_${options.width}`);
  if (typeof options.quality === "number") parts.push(`q_${options.quality}`);
  return `https://res.cloudinary.com/${cloudName}/image/fetch/${parts.join(",")}/${enc}`;
}

/**
 * URL for thanks-landscape image. When NEXT_PUBLIC_CLOUDINARY_THANKS_IMAGE is set (public_id of uploaded asset),
 * returns Cloudinary URL for high-res delivery. Otherwise returns relative path for local file.
 */
export function thanksLandscapeUrl(): string {
  if (cloudName && thanksImagePublicId) {
    return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto:best/${thanksImagePublicId}`;
  }
  return "/thanks-landscape.png";
}

/**
 * URL for directory background image (Support Local / Business Directory header).
 * Uses Cloudinary when configured; otherwise falls back to local /directory-background.png.
 */
export function directoryBackgroundUrl(): string {
  if (cloudName && directoryBackgroundPublicId) {
    return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto:best/w_1810,h_432,c_fill/${directoryBackgroundPublicId}`;
  }
  return "/directory-background.png";
}
