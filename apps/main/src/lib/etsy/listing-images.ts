import { normalizeEtsyPhotoUrls } from "database";
import { fetchListingPhotoSource, optimizeListingPhoto } from "@/lib/listing-photo-optimize";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

const MAX_ETSY_LISTING_IMAGES = 10;

/**
 * Download INW listing photos and upload binary images to an Etsy draft listing.
 * Etsy requires at least one image before a listing can be activated.
 */
export async function uploadEtsyListingPhotosFromUrls(input: {
  connectionId: string;
  memberId: string;
  shopId: string;
  etsyListingId: string;
  photos: string[] | null | undefined;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<{ uploaded: number; attempted: number; lastError: string | null }> {
  const urls = normalizeEtsyPhotoUrls(input.photos)
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => !/etsystatic\.com|etsyimg\.com/i.test(url))
    .slice(0, MAX_ETSY_LISTING_IMAGES);

  let uploaded = 0;
  let lastError: string | null = null;

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    try {
      const raw = await fetchListingPhotoSource(url);
      const jpeg = await optimizeListingPhoto(raw);
      const form = new FormData();
      const filename = `listing-${input.etsyListingId}-${i + 1}.jpg`;
      // Node/undici FormData accepts Blob/File; pass a copy so the binary is owned by the form.
      const bytes = new Uint8Array(jpeg);
      const blob =
        typeof File !== "undefined"
          ? new File([bytes], filename, { type: "image/jpeg" })
          : new Blob([bytes], { type: "image/jpeg" });
      form.append("image", blob, filename);
      form.append("rank", String(i + 1));
      form.append("overwrite", i === 0 ? "true" : "false");

      const res = await etsyConnectionRequest({
        connectionId: input.connectionId,
        memberId: input.memberId,
        method: "POST",
        path: `/shops/${encodeURIComponent(input.shopId)}/listings/${encodeURIComponent(input.etsyListingId)}/images`,
        body: form,
        bodyEncoding: "multipart",
        maxAttempts: 1,
        timeoutMs: 60_000,
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      if (res.ok) {
        uploaded += 1;
      } else {
        lastError = res.message || `Etsy image upload failed (${res.class})`;
        if (res.class === "THROTTLED" || res.class === "TRANSIENT" || res.class === "NETWORK") {
          break;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : "Photo upload failed";
    }
  }

  return { uploaded, attempted: urls.length, lastError };
}

/** True when Etsy listing already has at least one image. */
export async function etsyListingHasImages(input: {
  connectionId: string;
  memberId: string;
  etsyListingId: string;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<boolean> {
  const res = await etsyConnectionRequest<{ count?: number; results?: unknown[] }>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/listings/${encodeURIComponent(input.etsyListingId)}/images`,
    maxAttempts: 2,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!res.ok || !res.data) return false;
  if (typeof res.data.count === "number" && res.data.count > 0) return true;
  return Array.isArray(res.data.results) && res.data.results.length > 0;
}
