import { put } from "@vercel/blob";
import { fetchListingPhotoSource, optimizeListingPhoto } from "@/lib/listing-photo-optimize";
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

/** Max photos fully imported into Media Manager per sync (rest use optimized staging URLs). */
const WIX_MEDIA_MANAGER_IMPORT_MAX = 8;

/** Short-lived public JPEG URL Wix can fetch reliably (smaller than original blob). */
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

/**
 * Import one INW photo into the site's Media Manager (hosted on static.wixstatic.com).
 * Falls back to external URL when import is unavailable.
 */
export async function importPhotoToWixMediaManager(
  accessToken: string,
  sourceUrl: string,
  opts: WixRequestOpts,
  index: number
): Promise<WixProductMediaRef> {
  let importUrl = sourceUrl;
  let mimeType = "image/jpeg";

  try {
    const raw = await fetchListingPhotoSource(sourceUrl);
    const jpeg = await optimizeListingPhoto(raw);
    importUrl = await stagingUrlForWixImport(jpeg, index);
    mimeType = "image/jpeg";
  } catch (e) {
    console.warn("[wix] photo optimize/staging skipped, using source URL", {
      sourceUrl: sourceUrl.slice(0, 120),
      error: e instanceof Error ? e.message : String(e),
    });
  }

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

async function optimizedExternalRef(sourceUrl: string, index: number): Promise<WixProductMediaRef> {
  try {
    const raw = await fetchListingPhotoSource(sourceUrl);
    const jpeg = await optimizeListingPhoto(raw);
    const staging = await stagingUrlForWixImport(jpeg, index);
    return { url: staging };
  } catch {
    return { url: sourceUrl };
  }
}

/** Import listing photos into Wix Media Manager; per-photo fallback to optimized external URL. */
export async function resolveWixProductMediaRefs(
  accessToken: string,
  photoUrls: string[],
  opts: WixRequestOpts
): Promise<WixProductMediaRef[]> {
  const urls = photoUrls.filter(Boolean).slice(0, 12);

  const resolveOne = async (url: string, index: number): Promise<WixProductMediaRef> => {
    if (index >= WIX_MEDIA_MANAGER_IMPORT_MAX) {
      return optimizedExternalRef(url, index);
    }
    try {
      return await importPhotoToWixMediaManager(accessToken, url, opts, index);
    } catch (e) {
      console.warn("[wix] media manager import failed, using optimized URL", {
        url: url.slice(0, 120),
        error: e instanceof Error ? e.message : String(e),
      });
      return optimizedExternalRef(url, index);
    }
  };

  return Promise.all(urls.map((url, index) => resolveOne(url, index)));
}
