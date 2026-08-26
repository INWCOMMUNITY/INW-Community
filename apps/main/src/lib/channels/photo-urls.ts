import { getBaseUrl } from "@/lib/get-base-url";

function hostnameOf(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const href = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    return new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Vercel Blob or local /uploads listing files — INW's canonical hosted copy. */
export function isInwHostedPhotoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/uploads/")) return true;
  const host = hostnameOf(trimmed);
  if (host === "blob.vercel-storage.com" || host?.endsWith(".blob.vercel-storage.com")) {
    return true;
  }
  try {
    const href = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    return new URL(href).pathname.startsWith("/uploads/");
  } catch {
    return /blob\.vercel-storage\.com/i.test(trimmed);
  }
}

/** Marketplace CDNs that re-host INW photos after a push. */
export function isMarketplaceCdnPhotoUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return /ebayimg\.com|ebaystatic\.com|etsystatic\.com|wixstatic\.com|shopify/i.test(url);
  return (
    host === "i.ebayimg.com" ||
    host.endsWith(".ebayimg.com") ||
    host === "ebaystatic.com" ||
    host.endsWith(".ebaystatic.com") ||
    host === "i.etsystatic.com" ||
    host.endsWith(".etsystatic.com") ||
    host.includes("wixstatic.com") ||
    host.includes("shopify.com") ||
    host.includes("shopifycdn.com")
  );
}

export function isWixStaticPhotoUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (host?.includes("wixstatic.com")) return true;
  return /wixstatic\.com/i.test(url);
}

export function marketplaceCdnFamily(url: string): "ebay" | "etsy" | "wix" | "shopify" | null {
  const host = hostnameOf(url)?.toLowerCase() ?? "";
  if (host.includes("wixstatic.com") || /wixstatic\.com/i.test(url)) return "wix";
  if (host.includes("ebayimg.com") || host.includes("ebaystatic.com")) return "ebay";
  if (host.includes("etsystatic.com")) return "etsy";
  if (host.includes("shopify")) return "shopify";
  return null;
}

function trimmedPhotoUrls(photos: string[]): string[] {
  return photos.filter((url) => typeof url === "string" && url.trim().length > 0).map((url) => url.trim());
}

function stripPhotoQuery(url: string): string {
  return url.split("?")[0] ?? url;
}

/**
 * Same-count marketplace CDN URLs (Wix re-hosts on every media write; Etsy/eBay mint new file ids).
 * Count changes are treated as a real photo edit.
 */
export function marketplaceCdnPhotoRehostOnly(local: string[], remote: string[]): boolean {
  const a = trimmedPhotoUrls(local);
  const b = trimmedPhotoUrls(remote);
  if (a.length === 0 || a.length !== b.length) return false;
  if (!a.every(isMarketplaceCdnPhotoUrl) || !b.every(isMarketplaceCdnPhotoUrl)) return false;
  const family = marketplaceCdnFamily(a[0]);
  if (!family) return false;
  return a.every((url) => marketplaceCdnFamily(url) === family) && b.every((url) => marketplaceCdnFamily(url) === family);
}

/** INW Blob/uploads identity changed since the last successful push of those hosted files. */
export function inwHostedPhotosChangedSinceLastPush(
  current: string[],
  lastPushed: string[] | null | undefined
): boolean {
  if (lastPushed == null) return false;
  const cur = trimmedPhotoUrls(current).filter(isInwHostedPhotoUrl).map(stripPhotoQuery);
  const prev = trimmedPhotoUrls(lastPushed).filter(isInwHostedPhotoUrl).map(stripPhotoQuery);
  if (cur.length === 0) return false;
  if (cur.length !== prev.length) return true;
  return cur.some((url, i) => url !== prev[i]);
}

export function readStoredPhotoUrls(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

/**
 * Fingerprint photos for catalog baselines. Marketplace CDNs re-host the same images under new
 * file ids; hashing those URLs causes false INW "edits" every sync.
 */
export function photosFingerprintForSyncHash(photos: string[]): string[] {
  const urls = trimmedPhotoUrls(photos);
  if (urls.length === 0) return [];
  if (urls.every(isInwHostedPhotoUrl)) {
    return urls.map(stripPhotoQuery);
  }
  if (urls.every(isMarketplaceCdnPhotoUrl)) {
    const family = marketplaceCdnFamily(urls[0]) ?? "cdn";
    return [`cdn:${family}:${urls.length}`];
  }
  return urls.map(stripPhotoQuery);
}

function photosEqualExact(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

/**
 * Keep INW Blob/uploads photos when inbound sync only sees marketplace CDN
 * derivatives of the same listing. Imported listings (already on a CDN) still
 * take the remote set so fills/thumbs can upgrade to the largest derivative.
 */
export function selectInboundListingPhotos(local: string[], remote: string[]): string[] {
  const localPhotos = local.filter((url) => typeof url === "string" && url.trim().length > 0);
  const remotePhotos = remote.filter((url) => typeof url === "string" && url.trim().length > 0);
  if (remotePhotos.length === 0) return localPhotos;
  if (localPhotos.length === 0) return remotePhotos;
  const localAllInw = localPhotos.every(isInwHostedPhotoUrl);
  const remoteAllMarketplace = remotePhotos.every(isMarketplaceCdnPhotoUrl);
  if (localAllInw && remoteAllMarketplace) return localPhotos;
  return remotePhotos;
}

export function inboundListingPhotosDiffer(local: string[], remote: string[]): boolean {
  return !photosEqualExact(local, selectInboundListingPhotos(local, remote));
}

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
