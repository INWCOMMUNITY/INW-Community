/** Must match upload API routes (e.g. /api/upload, /api/upload/event). */
export const MAX_UPLOAD_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_BUSINESS_GALLERY_PHOTOS = 12;

export function formatMaxUploadSizeLabel(): string {
  return "120MB";
}
