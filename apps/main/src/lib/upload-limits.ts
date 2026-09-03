/** Must match upload API routes (e.g. /api/upload/event, /api/upload/profile). */
export const MAX_UPLOAD_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_BUSINESS_GALLERY_PHOTOS = 12;

/**
 * Listing photos may be much larger camera originals. Bytes go direct to Blob
 * (not through the ~4.5MB Vercel function body). Must match mobile + /api/upload.
 */
export const MAX_LISTING_PHOTO_BYTES = 250 * 1024 * 1024;

export function formatMaxUploadSizeLabel(): string {
  return "120MB";
}

export function formatListingPhotoSizeLabel(): string {
  return "250MB";
}
