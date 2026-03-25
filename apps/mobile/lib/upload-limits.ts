/** Must match apps/main/src/app/api/upload/route.ts */
export const MAX_UPLOAD_FILE_BYTES = 160 * 1024 * 1024;
export const MAX_BUSINESS_GALLERY_PHOTOS = 12;

export function formatMaxUploadSizeLabel(): string {
  return "160MB";
}
