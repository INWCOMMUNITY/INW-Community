import { MAX_LISTING_PHOTO_BYTES } from "./upload-limits";

function fileExt(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i >= 0 ? fileName.slice(i).toLowerCase() : "";
}

export { MAX_LISTING_PHOTO_BYTES };

/** Max longest edge for listing photos (storefront + channel staging). */
export const LISTING_PHOTO_MAX_EDGE = 3200;
export const LISTING_JPEG_QUALITY = 92;

export const LISTING_PHOTO_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

const TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function listingPhotoEffectiveMime(rawType: string, fileName: string): string | null {
  const t = (rawType || "").toLowerCase().trim();
  const aliased = TYPE_ALIASES[t] ?? t;
  if ((LISTING_PHOTO_ALLOWED_TYPES as readonly string[]).includes(aliased)) return aliased;
  if (t !== "" && t !== "application/octet-stream") return null;
  const ext = fileExt(fileName);
  const inferred = EXT_TO_MIME[ext];
  return inferred && (LISTING_PHOTO_ALLOWED_TYPES as readonly string[]).includes(inferred)
    ? inferred
    : null;
}

export function listingPhotoExtForMime(mime: string, fileName: string): string {
  const fromName = fileExt(fileName);
  if (fromName.match(/^\.(jpe?g|png|webp|gif|heic|heif)$/i)) return fromName.toLowerCase();
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    default:
      return ".jpg";
  }
}

export function isManagedListingPhotoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "blob.vercel-storage.com" || host.endsWith(".blob.vercel-storage.com")) {
      return true;
    }
    if (host === "localhost" || host === "127.0.0.1") {
      return u.pathname.startsWith("/uploads/");
    }
    return false;
  } catch {
    return false;
  }
}
