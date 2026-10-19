/**
 * Custom-option photos: PUT directly to Vercel Blob so files over the
 * ~4.5MB serverless body cap still upload. Falls back to multipart locally.
 */

import * as FileSystem from "expo-file-system/legacy";
import { API_BASE, apiUploadFile, getToken } from "./api";
import { MAX_BUYER_FILE_BYTES } from "./upload-limits";

const USER_AGENT = "INWCommunity/1.0 (com.northwestcommunity.app; iOS)";
const BLOB_PUT_TIMEOUT_MS = 180000;

async function authHeaders(json: boolean): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...(API_BASE.includes("inwcommunity.com")
      ? {
          Origin: "https://www.inwcommunity.com",
          Referer: "https://www.inwcommunity.com/",
        }
      : {}),
  };
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (API_BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  if (API_BASE.includes("loca.lt")) headers["Bypass-Tunnel-Reminder"] = "true";
  return headers;
}

function uploadFraction(sent: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.max(0, Math.min(1, sent / expected));
}

/** PUT or multipart POST from disk, with byte progress. Returns null when the native uploader is unavailable. */
async function uploadFromDisk(args: {
  url: string;
  fileUri: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  binary: boolean;
  mimeType?: string;
  onProgress?: (fraction: number) => void;
  bindCancel: (cancel: () => void) => void;
}): Promise<{ status: number; body: string } | null> {
  let task: FileSystem.UploadTask;
  try {
    task = FileSystem.createUploadTask(
      args.url,
      args.fileUri,
      args.binary
        ? {
            httpMethod: args.method,
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
            headers: args.headers,
          }
        : {
            httpMethod: args.method,
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
            headers: args.headers,
            fieldName: "file",
            mimeType: args.mimeType,
          },
      (data) => {
        args.onProgress?.(uploadFraction(data.totalBytesSent, data.totalBytesExpectedToSend));
      }
    );
  } catch {
    return null;
  }
  args.bindCancel(() => {
    task.cancelAsync().catch(() => {});
  });
  let result: FileSystem.FileSystemUploadResult | undefined | null;
  try {
    result = await task.uploadAsync();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unavailable|uploadTaskStartAsync/i.test(message)) return null;
    throw error;
  }
  if (!result) throw { error: "Upload canceled", cancelled: true, status: 0 };
  return { status: result.status, body: result.body ?? "" };
}

export async function uploadBuyerFileFromUri(opts: {
  localUri: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  onProgress?: (fraction: number) => void;
  /** Called once so the screen can stop the upload. */
  registerCancel?: (cancel: () => void) => void;
}): Promise<{ url: string }> {
  if (typeof opts.fileSize === "number" && opts.fileSize > MAX_BUYER_FILE_BYTES) {
    throw { error: "Each file must be under 250MB.", status: 400 };
  }
  const contentType = opts.mimeType || "image/jpeg";
  const filenameHint = opts.fileName || "photo.jpg";
  let cancelled = false;
  let cancelTask = () => {};
  const cancel = () => {
    cancelled = true;
    cancelTask();
  };
  opts.registerCancel?.(cancel);
  opts.onProgress?.(0);

  const tokenRes = await fetch(`${API_BASE}/api/upload/buyer-file/client-token`, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ contentType, filenameHint }),
  });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    pathname?: string;
    clientToken?: string;
    contentType?: string;
    code?: string;
    error?: string;
  };

  if (cancelled) throw { error: "Upload canceled", cancelled: true, status: 0 };

  if (tokenRes.ok && tokenData.pathname && tokenData.clientToken && tokenData.contentType) {
    const parts = tokenData.clientToken.split("_");
    const storeId = parts[3] ?? "";
    const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const uploaded = await uploadFromDisk({
      url: `https://blob.vercel-storage.com/${tokenData.pathname}`,
      fileUri: opts.localUri,
      method: "PUT",
      binary: true,
      headers: {
        Authorization: `Bearer ${tokenData.clientToken}`,
        "x-api-version": "7",
        "x-api-blob-request-id": requestId,
        "x-api-blob-request-attempt": "0",
        "x-content-type": tokenData.contentType,
      },
      onProgress: opts.onProgress,
      bindCancel: (stop) => {
        cancelTask = stop;
        if (cancelled) stop();
      },
    });
    if (uploaded) {
      if (uploaded.status < 200 || uploaded.status >= 300) {
        throw { error: "Upload to storage failed", status: uploaded.status };
      }
      let json: { url?: string } = {};
      try {
        json = JSON.parse(uploaded.body || "{}") as { url?: string };
      } catch {
        json = {};
      }
      if (!json.url) throw { error: "Upload succeeded but no URL returned", status: 500 };
      opts.onProgress?.(1);
      return { url: json.url };
    }

    const fileRes = await fetch(opts.localUri);
    if (!fileRes.ok) throw { error: "Could not read the selected photo.", status: 0 };
    const blob = await fileRes.blob();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BLOB_PUT_TIMEOUT_MS);
    cancelTask = () => controller.abort();
    if (cancelled) controller.abort();
    try {
      const putRes = await fetch(`https://blob.vercel-storage.com/${tokenData.pathname}`, {
        method: "PUT",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${tokenData.clientToken}`,
          "x-api-version": "7",
          "x-api-blob-request-id": requestId,
          "x-api-blob-request-attempt": "0",
          "x-content-type": tokenData.contentType,
        },
        body: blob,
      });
      if (!putRes.ok) throw { error: "Upload to storage failed", status: putRes.status };
      const json = (await putRes.json()) as { url?: string };
      if (!json.url) throw { error: "Upload succeeded but no URL returned", status: 500 };
      opts.onProgress?.(1);
      return { url: json.url };
    } catch (error) {
      if (cancelled) throw { error: "Upload canceled", cancelled: true, status: 0 };
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (tokenData.code !== "USE_MULTIPART_FALLBACK" && tokenRes.status !== 503) {
    throw { error: tokenData.error || "Could not prepare upload", status: tokenRes.status };
  }

  if (cancelled) throw { error: "Upload canceled", cancelled: true, status: 0 };

  const disk = await uploadFromDisk({
    url: `${API_BASE}/api/upload/buyer-file`,
    fileUri: opts.localUri,
    method: "POST",
    binary: false,
    mimeType: contentType,
    headers: await authHeaders(false),
    onProgress: opts.onProgress,
    bindCancel: (stop) => {
      cancelTask = stop;
      if (cancelled) stop();
    },
  });
  if (disk) {
    if (disk.status < 200 || disk.status >= 300) {
      let message = "Upload failed";
      try {
        const parsed = JSON.parse(disk.body) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // Keep the short message when the server did not return JSON.
      }
      throw { error: message, status: disk.status };
    }
    let json: { url?: string } = {};
    try {
      json = JSON.parse(disk.body || "{}") as { url?: string };
    } catch {
      json = {};
    }
    if (!json.url) throw { error: "Upload succeeded but no URL returned", status: 500 };
    opts.onProgress?.(1);
    return { url: json.url };
  }

  const form = new FormData();
  form.append("file", {
    uri: opts.localUri,
    name: filenameHint,
    type: contentType,
  } as unknown as Blob);
  const uploaded = await apiUploadFile("/api/upload/buyer-file", form);
  opts.onProgress?.(1);
  return uploaded;
}
