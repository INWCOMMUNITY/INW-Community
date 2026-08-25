import { put } from "@vercel/blob";
import { fetchListingPhotoSource, optimizeListingPhoto } from "@/lib/listing-photo-optimize";
import { isInwHostedPhotoUrl } from "../photo-urls";
import { wixGet, wixJson, type WixRequestOpts } from "./client";

type WixFileDescriptor = {
  id?: string;
  url?: string;
  operationStatus?: string;
  state?: string;
};

type ImportFileResponse = { file?: WixFileDescriptor };

export type WixProductMediaRef =
  | { mediaId: string; wixUrl: string }
  | { url: string };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Max photos fully imported into Media Manager per sync (rest use public/staging URLs). */
const WIX_MEDIA_MANAGER_IMPORT_MAX = 8;

function isWixStaticPhotoUrl(url: string): boolean {
  return /wixstatic\.com/i.test(url);
}

/** True when Wix should fetch the listing URL as-is instead of a re-encoded staging JPEG. */
export function shouldPassThroughListingPhotoToWix(sourceUrl: string): boolean {
  return isInwHostedPhotoUrl(sourceUrl) || isWixStaticPhotoUrl(sourceUrl);
}

/** Re-importing static.wixstatic.com URLs mints new file ids, 429s, and can wipe media. */
export function shouldReplaceWixProductMedia(photos: string[]): boolean {
  const urls = photos.filter((url) => typeof url === "string" && url.trim().length > 0);
  if (urls.length === 0) return false;
  return urls.some((url) => !isWixStaticPhotoUrl(url));
}

function mimeTypeForPhotoUrl(url: string): string {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Short-lived public JPEG URL Wix can fetch when the source URL is not importable. */
export async function stagingUrlForWixImport(jpeg: Buffer, index: number): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN not configured");
  }
  const key = `wix-import/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.jpg`;
  const blob = await put(key, jpeg, {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: false,
  });
  return blob.url;
}

async function waitForWixFileReady(
  accessToken: string,
  fileId: string,
  opts: WixRequestOpts,
  maxMs = 30_000
): Promise<WixFileDescriptor> {
  const deadline = Date.now() + maxMs;
  let last: WixFileDescriptor | undefined;
  while (Date.now() < deadline) {
    const res = await wixGet<{ file?: WixFileDescriptor }>(
      accessToken,
      `/site-media/v1/files/${encodeURIComponent(fileId)}`,
      opts
    );
    last = res.file;
    if (last?.state === "FAILED") {
      throw new Error("Wix media import failed on Wix servers");
    }
    if (last?.operationStatus === "READY" && last.url && last.id) {
      return last;
    }
    await sleep(1200);
  }
  throw new Error(
    `Wix media import timed out (${last?.operationStatus ?? "unknown"} for ${fileId})`
  );
}

async function importWixFileFromUrl(
  accessToken: string,
  importUrl: string,
  opts: WixRequestOpts,
  index: number,
  mimeType: string
): Promise<WixProductMediaRef> {
  const imported = await wixJson<ImportFileResponse>(
    accessToken,
    "/site-media/v1/files/import",
    "POST",
    {
      url: importUrl,
      mimeType,
      private: false,
      displayName: `inw-listing-${index + 1}.jpg`,
    },
    opts
  );

  const fileId = imported.file?.id;
  if (!fileId) {
    throw new Error("Wix media import returned no file id");
  }

  const ready =
    imported.file?.operationStatus === "READY" && imported.file.url
      ? imported.file
      : await waitForWixFileReady(accessToken, fileId, opts);

  if (!ready.id || !ready.url) {
    throw new Error("Wix media import missing file id/url after ready");
  }

  return { mediaId: ready.id, wixUrl: ready.url };
}

async function stagingJpegUrl(sourceUrl: string, index: number): Promise<string> {
  const raw = await fetchListingPhotoSource(sourceUrl);
  const jpeg = await optimizeListingPhoto(raw);
  return stagingUrlForWixImport(jpeg, index);
}

/**
 * Import one INW photo into the site's Media Manager (hosted on static.wixstatic.com).
 * Tries the public source URL first; only re-encodes to a staging JPEG if Wix cannot fetch it.
 */
export async function importPhotoToWixMediaManager(
  accessToken: string,
  sourceUrl: string,
  opts: WixRequestOpts,
  index: number
): Promise<WixProductMediaRef> {
  try {
    return await importWixFileFromUrl(
      accessToken,
      sourceUrl,
      opts,
      index,
      mimeTypeForPhotoUrl(sourceUrl)
    );
  } catch (first) {
    console.warn("[wix] media import from source URL failed, staging optimized JPEG", {
      sourceUrl: sourceUrl.slice(0, 120),
      error: first instanceof Error ? first.message : String(first),
    });
    const staging = await stagingJpegUrl(sourceUrl, index);
    return importWixFileFromUrl(accessToken, staging, opts, index, "image/jpeg");
  }
}

async function optimizedExternalRef(sourceUrl: string, index: number): Promise<WixProductMediaRef> {
  if (shouldPassThroughListingPhotoToWix(sourceUrl)) {
    return { url: sourceUrl };
  }
  try {
    const staging = await stagingJpegUrl(sourceUrl, index);
    return { url: staging };
  } catch {
    return { url: sourceUrl };
  }
}

/** Import listing photos into Wix Media Manager; per-photo fallback to public/staging URL. */
export async function resolveWixProductMediaRefs(
  accessToken: string,
  photoUrls: string[],
  opts: WixRequestOpts
): Promise<WixProductMediaRef[]> {
  const urls = photoUrls.filter(Boolean).slice(0, 12);

  const resolveOne = async (url: string, index: number): Promise<WixProductMediaRef> => {
    if (isWixStaticPhotoUrl(url)) {
      return { url };
    }
    if (index >= WIX_MEDIA_MANAGER_IMPORT_MAX) {
      return optimizedExternalRef(url, index);
    }
    try {
      return await importPhotoToWixMediaManager(accessToken, url, opts, index);
    } catch (e) {
      console.warn("[wix] media manager import failed, using public/staging URL", {
        url: url.slice(0, 120),
        error: e instanceof Error ? e.message : String(e),
      });
      return optimizedExternalRef(url, index);
    }
  };

  return Promise.all(urls.map((url, index) => resolveOne(url, index)));
}
