/** Cloud name - use NEXT_PUBLIC_ for client-safe usage (no cloudinary SDK, avoids fs in browser) */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

/**
 * Proxy external image URLs through Cloudinary for higher resolution and optimization.
 * Relative URLs (same-origin) are returned as-is so they load directly from the app.
 * Cloudinary fetch can fail for same-origin URLs due to account restrictions or allowlists.
 */
export function cloudinaryFetchUrl(
  sourceUrl: string,
  options: { width?: number; quality?: "auto" | "auto:best" | "auto:good" | number } = {}
): string {
  if (!cloudName || !sourceUrl) return sourceUrl ?? "";
  if (sourceUrl.startsWith("/")) return sourceUrl;
  const enc = encodeURIComponent(sourceUrl);
  const parts: string[] = ["f_auto", "q_auto:best"];
  if (options.width) parts.push(`w_${options.width}`);
  if (typeof options.quality === "number") parts.push(`q_${options.quality}`);
  return `https://res.cloudinary.com/${cloudName}/image/fetch/${parts.join(",")}/${enc}`;
}
