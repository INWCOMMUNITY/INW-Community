/** Must match upload API routes (e.g. /api/upload/event, /api/upload/profile). */
export const MAX_UPLOAD_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_BUSINESS_GALLERY_PHOTOS = 12;

/**
 * Listing photos and buyer custom-option files may be large camera originals.
 * Bytes go direct to Blob (not through the ~4.5MB Vercel function body).
 */
export const MAX_LISTING_PHOTO_BYTES = 250 * 1024 * 1024;

/** Buyer custom-option files (photos, PDF). Same ceiling as listing photos. */
export const MAX_BUYER_FILE_BYTES = MAX_LISTING_PHOTO_BYTES;

export function formatMaxUploadSizeLabel(): string {
  return "120MB";
}

export function formatListingPhotoSizeLabel(): string {
  return "250MB";
}

export function formatBuyerFileSizeLabel(): string {
  return "250MB";
}
