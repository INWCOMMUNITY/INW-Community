import { etsyDelete, etsyGet, etsyUploadImage } from "./client";

export const ETSY_MAX_LISTING_IMAGES = 10;

export type EtsyListingImage = {
  listing_image_id: number;
  url_fullxfull?: string;
  url_570xN?: string;
  rank?: number;
};

export type EtsyPhotoSyncPlan = {
  uploadUrls: string[];
  deleteBeforeUpload: number[];
  deleteAfterUpload: number[];
};

export function readLastPushedPhotos(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const urls = value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  return urls;
}

export function inwPhotoUrlsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

function isChannelCdnPhotoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("etsystatic") ||
      host.includes("ebayimg") ||
      host.includes("ebaystatic")
    );
  } catch {
    return /etsystatic|ebayimg|ebaystatic/i.test(url);
  }
}

/** GetItem/Etsy rehost overwrote INW blobs with marketplace CDNs — not a seller photo change. */
export function inwPhotosAreChannelRehost(inw: string[], lastPushed: string[]): boolean {
  if (inw.length === 0 || lastPushed.length === 0) return false;
  if (inwPhotoUrlsMatch(inw, lastPushed)) return false;
  const inwAllCdn = inw.every(isChannelCdnPhotoUrl);
  if (!inwAllCdn) return false;
  const lastHadSelfHosted = lastPushed.some((url) => !isChannelCdnPhotoUrl(url));
  if (lastHadSelfHosted) return true;
  return inw.length === lastPushed.length;
}

function normalizeInwPhotos(photos: string[]): string[] {
  const out: string[] = [];
  for (const raw of photos) {
    const url = raw.trim();
    if (url && !out.includes(url)) out.push(url);
  }
  return out.slice(0, ETSY_MAX_LISTING_IMAGES);
}

function sortedEtsyImages(images: EtsyListingImage[]): EtsyListingImage[] {
  return [...images].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

/** Keep ≥1 existing image until new uploads succeed; free slots when at Etsy's 10-image cap. */
export function planEtsyPhotoReplaceOrder(
  etsyImages: EtsyListingImage[],
  uploadCount: number
): { deleteBeforeUpload: number[]; deleteAfterUpload: number[] } {
  const ids = sortedEtsyImages(etsyImages).map((img) => img.listing_image_id);
  const room = Math.max(0, ETSY_MAX_LISTING_IMAGES - ids.length);
  if (uploadCount <= room) {
    return { deleteBeforeUpload: [], deleteAfterUpload: ids };
  }
  const need = uploadCount - room;
  const canDeleteBefore = Math.max(0, ids.length - 1);
  const deleteBeforeUpload = ids.slice(ids.length - Math.min(need, canDeleteBefore));
  const before = new Set(deleteBeforeUpload);
  return {
    deleteBeforeUpload,
    deleteAfterUpload: ids.filter((id) => !before.has(id)),
  };
}

/**
 * Etsy has no replace-images API and re-hosts uploads, so INW blob URLs never match
 * live Etsy CDN URLs. Never append the full INW set on a title/price update.
 */
export function planEtsyPhotoSync(args: {
  inwPhotos: string[];
  etsyImages: EtsyListingImage[];
  lastPushedInwPhotos: string[] | null;
}): EtsyPhotoSyncPlan {
  const inw = normalizeInwPhotos(args.inwPhotos);
  const etsy = sortedEtsyImages(args.etsyImages);

  if (inw.length === 0) {
    return { uploadUrls: [], deleteBeforeUpload: [], deleteAfterUpload: [] };
  }

  if (
    args.lastPushedInwPhotos != null &&
    inwPhotoUrlsMatch(inw, normalizeInwPhotos(args.lastPushedInwPhotos))
  ) {
    return { uploadUrls: [], deleteBeforeUpload: [], deleteAfterUpload: [] };
  }

  if (
    args.lastPushedInwPhotos != null &&
    inwPhotosAreChannelRehost(inw, normalizeInwPhotos(args.lastPushedInwPhotos))
  ) {
    return { uploadUrls: [], deleteBeforeUpload: [], deleteAfterUpload: [] };
  }

  if (args.lastPushedInwPhotos != null) {
    const order = planEtsyPhotoReplaceOrder(etsy, inw.length);
    return { uploadUrls: inw, ...order };
  }

  // Existing links with no snapshot: trimming extras undoes prior doubling.
  // Do not re-upload when Etsy already has at least as many images as INW.
  if (etsy.length >= inw.length) {
    return {
      uploadUrls: [],
      deleteBeforeUpload: [],
      deleteAfterUpload: etsy.slice(inw.length).map((img) => img.listing_image_id),
    };
  }

  return {
    uploadUrls: inw.slice(etsy.length),
    deleteBeforeUpload: [],
    deleteAfterUpload: [],
  };
}

export async function etsyListListingImages(
  accessToken: string,
  listingId: string
): Promise<EtsyListingImage[] | null> {
  try {
    const body = await etsyGet<{
      images?: EtsyListingImage[];
      results?: EtsyListingImage[];
    }>(accessToken, `/listings/${encodeURIComponent(listingId)}/images`);
    const rows = body.results ?? body.images ?? [];
    if (Array.isArray(rows)) return rows;
  } catch {
    /* fall through to listing includes */
  }
  try {
    const listing = await etsyGet<{ images?: EtsyListingImage[] }>(
      accessToken,
      `/listings/${encodeURIComponent(listingId)}?includes=Images`
    );
    return Array.isArray(listing.images) ? listing.images : [];
  } catch {
    return null;
  }
}

export async function syncEtsyListingPhotos(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  inwPhotos: string[];
  lastPushedInwPhotos: string[] | null;
}): Promise<void> {
  let etsyImages: EtsyListingImage[] = [];
  try {
    const listed = await etsyListListingImages(args.accessToken, args.listingId);
    if (listed == null) return;
    etsyImages = listed;
  } catch {
    return;
  }

  const plan = planEtsyPhotoSync({
    inwPhotos: args.inwPhotos,
    etsyImages,
    lastPushedInwPhotos: args.lastPushedInwPhotos,
  });

  if (
    plan.uploadUrls.length === 0 &&
    plan.deleteBeforeUpload.length === 0 &&
    plan.deleteAfterUpload.length === 0
  ) {
    return;
  }

  const deleteImage = async (listingImageId: number) => {
    await etsyDelete(
      args.accessToken,
      `/shops/${args.shopId}/listings/${args.listingId}/images/${listingImageId}`
    );
  };

  for (const id of plan.deleteBeforeUpload) {
    try {
      await deleteImage(id);
    } catch (e) {
      console.error("[etsy] photo delete failed", {
        listingId: args.listingId,
        listingImageId: id,
        error: String(e),
      });
    }
  }

  let rank = Math.max(1, etsyImages.length - plan.deleteBeforeUpload.length + 1);
  let uploaded = 0;
  for (const url of plan.uploadUrls) {
    try {
      await etsyUploadImage(args.accessToken, args.shopId, args.listingId, url, rank);
      uploaded += 1;
      rank += 1;
    } catch (e) {
      console.error("[etsy] photo upload failed", { listingId: args.listingId, url, error: String(e) });
    }
  }

  if (plan.uploadUrls.length > 0 && uploaded < plan.uploadUrls.length) {
    console.warn("[etsy] skip deleting existing photos after incomplete upload", {
      listingId: args.listingId,
      uploaded,
      attempted: plan.uploadUrls.length,
    });
    return;
  }

  for (const id of plan.deleteAfterUpload) {
    try {
      await deleteImage(id);
    } catch (e) {
      console.error("[etsy] photo delete failed", {
        listingId: args.listingId,
        listingImageId: id,
        error: String(e),
      });
    }
  }
}
