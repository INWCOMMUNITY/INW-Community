import { formatBuyerFileSizeLabel, MAX_BUYER_FILE_BYTES } from "@/lib/upload-limits";

const BLOB_PUT_TIMEOUT_MS = 180_000;
const MULTIPART_SAFE_BYTES = 4 * 1024 * 1024;

function extOk(name: string): boolean {
  return /\.(jpe?g|png|svg|webp|hei[cf]|pdf)$/i.test(name);
}

/**
 * Upload a custom-option file. Large photos go straight to Blob so they are
 * not cut off by the serverless body limit. Reports upload percent via onProgress.
 */
export function uploadBuyerFile(
  file: File,
  onProgress: (percent: number) => void
): Promise<string> {
  if (file.size > MAX_BUYER_FILE_BYTES) {
    return Promise.reject(new Error(`Each file must be under ${formatBuyerFileSizeLabel()}.`));
  }
  if (file.type && file.type !== "application/octet-stream" && !extOk(file.name)) {
    const allowed =
      file.type.startsWith("image/") || file.type === "application/pdf" || extOk(file.name);
    if (!allowed) {
      return Promise.reject(new Error("Use jpg, png, svg, pdf, webp, or heic."));
    }
  }

  return uploadDirect(file, onProgress).catch(async (error) => {
    const fallback = error instanceof Error && error.message === "USE_MULTIPART_FALLBACK";
    if (fallback || file.size <= MULTIPART_SAFE_BYTES) return uploadMultipart(file, onProgress);
    throw error instanceof Error ? error : new Error("Upload failed");
  });
}

async function uploadDirect(file: File, onProgress: (percent: number) => void): Promise<string> {
  const tokenRes = await fetch("/api/upload/buyer-file/client-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, filenameHint: file.name }),
  });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    pathname?: string;
    clientToken?: string;
    contentType?: string;
    code?: string;
    error?: string;
  };
  if (!tokenRes.ok || !tokenData.pathname || !tokenData.clientToken || !tokenData.contentType) {
    if (tokenData.code === "USE_MULTIPART_FALLBACK") {
      throw new Error("USE_MULTIPART_FALLBACK");
    }
    throw new Error(tokenData.error || "Could not prepare upload");
  }
  onProgress(8);
  return putBlob(tokenData.pathname, tokenData.clientToken, tokenData.contentType, file, onProgress);
}

function putBlob(
  pathname: string,
  clientToken: string,
  contentType: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<string> {
  const parts = clientToken.split("_");
  const storeId = parts[3] ?? "";
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timer = window.setTimeout(() => {
      xhr.abort();
      reject(new Error("Upload timed out. Try again on a faster connection."));
    }, BLOB_PUT_TIMEOUT_MS);
    xhr.open("PUT", `https://blob.vercel-storage.com/${pathname}`);
    xhr.setRequestHeader("Authorization", `Bearer ${clientToken}`);
    xhr.setRequestHeader("x-api-version", "7");
    xhr.setRequestHeader("x-api-blob-request-id", requestId);
    xhr.setRequestHeader("x-api-blob-request-attempt", "0");
    xhr.setRequestHeader("x-content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.max(8, Math.round((event.loaded / event.total) * 92)));
      }
    };
    xhr.onload = () => {
      window.clearTimeout(timer);
      let data: { url?: string } = {};
      try {
        data = JSON.parse(xhr.responseText) as { url?: string };
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        onProgress(100);
        resolve(data.url);
        return;
      }
      reject(new Error("Upload to storage failed"));
    };
    xhr.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Upload failed"));
    };
    xhr.onabort = () => {
      window.clearTimeout(timer);
    };
    xhr.send(file);
  });
}

function uploadMultipart(file: File, onProgress: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload/buyer-file");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      let data: { url?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText) as { url?: string; error?: string };
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        onProgress(100);
        resolve(data.url);
        return;
      }
      reject(new Error(data.error || "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}
