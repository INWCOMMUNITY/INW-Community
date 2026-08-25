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
