import { LISTING_PHOTO_MAX_EDGE, listingPhotoEffectiveMime } from "@/lib/listing-photo-upload";
import { formatListingPhotoSizeLabel, MAX_LISTING_PHOTO_BYTES } from "@/lib/upload-limits";

const BLOB_PUT_TIMEOUT_MS = 180_000;
const MULTIPART_SAFE_BYTES = 4 * 1024 * 1024;

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("/")) return `${window.location.origin}${url}`;
  return url;
}

async function prepareListingPhotoForUpload(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as unknown as ImageBitmapOptions);
  } catch {
    return file;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const alreadySmallJpeg =
      longest <= LISTING_PHOTO_MAX_EDGE &&
      file.size <= MULTIPART_SAFE_BYTES &&
      (file.type === "image/jpeg" || file.type === "image/jpg");
    if (alreadySmallJpeg) return file;

    const scale = longest > LISTING_PHOTO_MAX_EDGE ? LISTING_PHOTO_MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

async function uploadViaMultipart(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Upload failed");
  const url = (data as { url?: string }).url;
  if (!url) throw new Error("No URL returned");
  return toAbsoluteUrl(url);
}

async function putListingBlob(
  pathname: string,
  clientToken: string,
  contentType: string,
  file: File
): Promise<string> {
  const parts = clientToken.split("_");
  const storeId = parts[3] ?? "";
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BLOB_PUT_TIMEOUT_MS);
  try {
    const putRes = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: "PUT",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${clientToken}`,
        "x-api-version": "7",
        "x-api-blob-request-id": requestId,
        "x-api-blob-request-attempt": "0",
        "x-content-type": contentType,
      },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error("Upload to storage failed");
    }
    const json = (await putRes.json()) as { url?: string };
    if (!json.url) throw new Error("Upload succeeded but no URL returned");
    return json.url;
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      throw new Error("Upload timed out. Try again on a faster connection.");
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function optimizeListingBlob(
  url: string,
  sourceLooksHeic: boolean
): Promise<string> {
  const res = await fetch("/api/upload/listing/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    optimized?: boolean;
  };
  if (res.ok && typeof data.url === "string") {
    if (sourceLooksHeic && data.optimized === false) {
      throw new Error(
        "This photo format (HEIC) couldn't be processed. Export it as JPEG and try again."
      );
    }
    return toAbsoluteUrl(data.url);
  }
  if (sourceLooksHeic) {
    throw new Error(
      "This photo format (HEIC) couldn't be processed. Export it as JPEG and try again."
    );
  }
  return toAbsoluteUrl(url);
}

/**
 * Upload a listing photo. Prefers direct Blob PUT (large originals) and
 * falls back to multipart /api/upload for local dev.
 */
export async function uploadListingPhoto(file: File): Promise<string> {
  if (file.size > MAX_LISTING_PHOTO_BYTES) {
    throw new Error(`Each photo must be under ${formatListingPhotoSizeLabel()}.`);
  }
  if (!listingPhotoEffectiveMime(file.type, file.name)) {
    throw new Error("Invalid file type. Use JPEG, PNG, WebP, GIF, or HEIC.");
  }

  const prepared = await prepareListingPhotoForUpload(file);

  const tokenRes = await fetch("/api/upload/listing/client-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentType: prepared.type,
      filenameHint: prepared.name,
    }),
  });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    pathname?: string;
    clientToken?: string;
    contentType?: string;
    code?: string;
    error?: string;
  };

  if (tokenRes.ok && tokenData.pathname && tokenData.clientToken && tokenData.contentType) {
    const storedUrl = await putListingBlob(
      tokenData.pathname,
      tokenData.clientToken,
      tokenData.contentType,
      prepared
    );
    const looksHeic = /heic|heif/i.test(`${file.type} ${file.name} ${prepared.type} ${prepared.name}`);
    return optimizeListingBlob(storedUrl, looksHeic);
  }

  const fallback = tokenRes.status === 503 && tokenData.code === "USE_MULTIPART_FALLBACK";
  if (fallback || prepared.size <= MULTIPART_SAFE_BYTES) {
    return uploadViaMultipart(prepared);
  }

  throw new Error(tokenData.error ?? "Photo upload failed.");
}

export { MAX_LISTING_PHOTO_BYTES, formatListingPhotoSizeLabel };
