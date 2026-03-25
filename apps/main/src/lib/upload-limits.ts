/** Must match apps/main/src/app/api/upload/route.ts */
export const MAX_UPLOAD_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_BUSINESS_GALLERY_PHOTOS = 12;

export function formatMaxUploadSizeLabel(): string {
  return "120MB";
}
