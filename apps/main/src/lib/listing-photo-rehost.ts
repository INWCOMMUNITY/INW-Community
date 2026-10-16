import { put } from "@vercel/blob";
import { fetchListingPhotoSource, optimizeListingPhoto } from "@/lib/listing-photo-optimize";

const INW_BLOB_PATTERNS = [
  /vercel-storage\.com/i,
  /blob\.vercel-storage\.com/i,
  /public\.blob\.vercel-storage\.com/i,
];

/** Check if a URL is hosted on INW (Vercel Blob). */
function isInwHostedPhotoUrl(url: string): boolean {
  return INW_BLOB_PATTERNS.some((pattern) => pattern.test(url));
}

/** Check if a URL is from a known marketplace CDN. */
function isMarketplaceCdnPhotoUrl(url: string): boolean {
  const patterns = [
    /i\.etsystatic\.com/i,
    /etsystatic\.com/i,
    /etsyimg\.com/i,
    /i\.ebayimg\.com/i,
    /cdn\.shopify\.com/i,
    /static\.wixstatic\.com/i,
  ];
  return patterns.some((pattern) => pattern.test(url));
}

/**
 * True when the gallery is entirely marketplace CDN photos (no INW blobs yet).
 * Used by import/bootstrap gates; sync rehost is per-URL via ensureInwHostedListingPhotos.
 */
export function shouldCopyMarketplacePhotosToInw(photos: string[]): boolean {
  const urls = photos.filter((url) => typeof url === "string" && url.trim().length > 0);
  if (urls.length === 0) return false;
  if (urls.some(isInwHostedPhotoUrl)) return false;
  return urls.every(isMarketplaceCdnPhotoUrl);
}

async function copyMarketplacePhotoToInw(sourceUrl: string, index: number): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;
  try {
    const jpeg = await optimizeListingPhoto(await fetchListingPhotoSource(sourceUrl));
    const key = `listing-rehost/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.jpg`;
    const blob = await put(key, jpeg, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
    });
    return blob.url?.trim() || null;
  } catch (e) {
    console.warn("[photos] marketplace rehost failed", {
      sourceUrl: sourceUrl.slice(0, 80),
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Copy marketplace CDN photos onto INW-hosted files (per URL).
 * Leaves already-INW and non-marketplace URLs unchanged.
 */
export async function ensureInwHostedListingPhotos(photos: string[]): Promise<string[]> {
  const hosted = await Promise.all(
    photos.map(async (raw, i) => {
      const url = typeof raw === "string" ? raw.trim() : "";
      if (!url) return null;
      if (isInwHostedPhotoUrl(url) || !isMarketplaceCdnPhotoUrl(url)) return url;
      const copied = await copyMarketplacePhotoToInw(url, i);
      return copied || url;
    })
  );
  return hosted.filter((url): url is string => Boolean(url));
}
