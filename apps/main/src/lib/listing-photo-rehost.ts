import { put } from "@vercel/blob";
import { fetchListingPhotoSource, optimizeListingPhoto } from "@/lib/listing-photo-optimize";
import { isInwHostedPhotoUrl, isMarketplaceCdnPhotoUrl } from "@/lib/channels/photo-urls";

/** Copy marketplace CDNs onto INW Blob once — never when the listing already has INW files. */
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
 * One-time copy of Shopify/eBay/Etsy/Wix CDN photos onto INW-hosted files.
 * Leaves URLs unchanged when INW blobs already exist or Blob is not configured.
 */
export async function ensureInwHostedListingPhotos(photos: string[]): Promise<string[]> {
  if (!shouldCopyMarketplacePhotosToInw(photos)) return photos;
  const out: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    const url = photos[i]!.trim();
    const hosted = await copyMarketplacePhotoToInw(url, i);
    out.push(hosted || url);
  }
  return out;
}
