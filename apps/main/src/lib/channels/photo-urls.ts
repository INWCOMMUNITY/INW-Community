import { getBaseUrl } from "@/lib/get-base-url";

/** Public absolute URL required for Wix/Etsy/eBay/Shopify to import listing images. */
export function resolveChannelPhotoUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) {
    const base = getBaseUrl().replace(/\/+$/, "");
    return `${base}${trimmed}`;
  }
  return null;
}

export function resolveChannelPhotoUrls(photos: string[], max = 12): string[] {
  const out: string[] = [];
  for (const url of photos) {
    const resolved = resolveChannelPhotoUrl(url);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out.slice(0, max);
}
