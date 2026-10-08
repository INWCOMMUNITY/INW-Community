import { resolveShopifyMediaSourceUrl } from "@/lib/shopify/media-source-url";

/** Public https URLs Wix can fetch. Relative INW paths are made absolute. */
export function wixPublicPhotoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    if (typeof photo !== "string" || !photo.trim()) continue;
    const resolved = resolveShopifyMediaSourceUrl(photo);
    if (!resolved.ok || seen.has(resolved.url)) continue;
    seen.add(resolved.url);
    urls.push(resolved.url);
  }
  return urls;
}

export function wixV1ProductMedia(urls: string[]): { items: Array<{ image: { url: string } }> } | undefined {
  if (urls.length === 0) return undefined;
  return { items: urls.map((url) => ({ image: { url } })) };
}

export function wixV3ProductMedia(urls: string[]): {
  itemsInfo: { items: Array<{ url: string }> };
} | undefined {
  if (urls.length === 0) return undefined;
  return { itemsInfo: { items: urls.map((url) => ({ url })) } };
}
