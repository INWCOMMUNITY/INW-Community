/** Must match apps/main upload routes (e.g. /api/upload/event, /api/upload/profile). */
export const MAX_UPLOAD_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_BUSINESS_GALLERY_PHOTOS = 12;

/** Must match apps/main listing photo limit (/api/upload + /api/upload/listing). */
export const MAX_LISTING_PHOTO_BYTES = 250 * 1024 * 1024;

export function formatMaxUploadSizeLabel(): string {
  return "120MB";
}

export function formatListingPhotoSizeLabel(): string {
  return "250MB";
}
