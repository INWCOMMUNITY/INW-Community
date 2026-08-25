/**
 * Display-sized listing photo URLs. Stored DB URLs stay full-size (eBay s-l2000, Wix originals).
 * Rewrite only at render/API time for thumbs and cards.
 */

export type ListingDisplayPhotoSize = "thumb" | "card" | "hero";

const DISPLAY_LONG_EDGE: Record<ListingDisplayPhotoSize, number> = {
  thumb: 225,
  card: 800,
  hero: 1600,
};

function isEbayImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "i.ebayimg.com" || host.endsWith(".ebayimg.com");
  } catch {
    return /ebayimg\.com/i.test(url);
  }
}

function wixOriginalMediaUrl(url: string): string {
  if (!url.includes("static.wixstatic.com/media")) return url;
  const v1 = url.indexOf("/v1/");
  return v1 === -1 ? url : url.slice(0, v1);
}

function wixDisplayUrl(url: string, edge: number): string {
  const original = wixOriginalMediaUrl(url);
  const file = original.split("/").pop();
  if (!file) return original;
  return `${original}/v1/fit/w_${edge},h_${edge},al_c,q_80,enc_auto/${encodeURIComponent(file)}`;
}

/** CDN long-edge derivative for the on-screen size. Other hosts are unchanged. */
export function listingDisplayPhoto(
  url: string | null | undefined,
  size: ListingDisplayPhotoSize
): string | null {
  if (!url) return null;
  const edge = DISPLAY_LONG_EDGE[size];
  if (isEbayImageHost(url)) {
    if (/s-l\d+/i.test(url)) {
      return url.replace(/s-l\d+/gi, `s-l${edge}`);
    }
    return url;
  }
  if (url.includes("static.wixstatic.com/media")) {
    return wixDisplayUrl(url, edge);
  }
  return url;
}

export function listingDisplayPhotos(
  photos: string[] | null | undefined,
  size: ListingDisplayPhotoSize,
  max = 2
): string[] {
  if (!photos?.length || max < 1) return [];
  const out: string[] = [];
  for (const raw of photos) {
    if (!raw) continue;
    const next = listingDisplayPhoto(raw, size);
    if (next) out.push(next);
    if (out.length >= max) break;
  }
  return out;
}
