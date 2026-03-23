/**
 * Wix (and similar CDNs) serve the same file with different /v1/fill/... URLs.
 * Compare by stable media path segment after /media/.
 */
export function imageMediaFileKey(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/media\/([^/]+\.(?:jpe?g|png|webp|gif))/i);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * Wix gallery URLs often include `/v1/fill/w_1200,h_800,...`, which downscales the image.
 * Strip transforms so clients load the original `static.wixstatic.com/media/...~mv2.*` asset.
 */
export function wixOriginalMediaUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("static.wixstatic.com/media")) return url;
  const v1 = url.indexOf("/v1/");
  if (v1 === -1) return url;
  return url.slice(0, v1);
}

/** Gallery should not repeat the logo image when the same asset was stored in `photos`. */
export function photosExcludingLogo(photos: string[], logoUrl: string | null | undefined): string[] {
  const normalized = photos.map((p) => wixOriginalMediaUrl(p));
  const logoKey = imageMediaFileKey(logoUrl);
  if (!logoKey) return normalized;
  return normalized.filter((p) => imageMediaFileKey(p) !== logoKey);
}
