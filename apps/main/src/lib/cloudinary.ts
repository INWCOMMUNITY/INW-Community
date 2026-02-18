/** Cloud name - use NEXT_PUBLIC_ for client-safe usage (no cloudinary SDK, avoids fs in browser) */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

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
 * Proxy any image URL through Cloudinary for higher resolution and optimization.
 * Use with next/image or img src. Returns original URL if Cloudinary not configured.
 * Skips Cloudinary for relative URLs in local dev (Cloudinary cannot fetch localhost).
 */
export function cloudinaryFetchUrl(
  sourceUrl: string,
  options: { width?: number; quality?: "auto" | "auto:best" | "auto:good" | number } = {}
): string {
  if (!cloudName || !sourceUrl) return sourceUrl ?? "";
  const base = getBaseUrl();
  const isLocalhost = /^https?:\/\/localhost(:\d+)?(\/|$)/i.test(base) || base.includes("127.0.0.1");
  if (sourceUrl.startsWith("/") && isLocalhost) {
    return sourceUrl;
  }
  const absUrl = sourceUrl.startsWith("/") ? `${base.replace(/\/$/, "")}${sourceUrl}` : sourceUrl;
  const enc = encodeURIComponent(absUrl);
  const parts: string[] = ["f_auto", "q_auto:best"];
  if (options.width) parts.push(`w_${options.width}`);
  if (typeof options.quality === "number") parts.push(`q_${options.quality}`);
  return `https://res.cloudinary.com/${cloudName}/image/fetch/${parts.join(",")}/${enc}`;
}
