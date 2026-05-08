import path from "path";

/** Shared limits & MIME rules for `/api/upload/post` (multipart + Blob client-token). */
export const POST_UPLOAD_MAX_IMAGE_BYTES = 60 * 1024 * 1024;
export const POST_UPLOAD_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export const POST_UPLOAD_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

/** Some Android/iOS pickers report MP4-in-M4V as video/x-m4v */
export const POST_UPLOAD_ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
] as const;

export function postUploadEffectiveMime(
  rawType: string,
  fileName: string,
  isVideo: boolean
): string | null {
  const t = (rawType || "").toLowerCase().trim();
  const allowed = isVideo ? POST_UPLOAD_ALLOWED_VIDEO_TYPES : POST_UPLOAD_ALLOWED_IMAGE_TYPES;
  if ((allowed as readonly string[]).includes(t)) return t;
  if (t !== "" && t !== "application/octet-stream") return null;
  const ext = path.extname(fileName).toLowerCase();
  const imageExt: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
  };
  const videoExt: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  const map = isVideo ? videoExt : imageExt;
  const inferred = map[ext];
  return inferred && (allowed as readonly string[]).includes(inferred) ? inferred : null;
}
