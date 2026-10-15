/**
 * Custom-option photos: PUT directly to Vercel Blob so files over the
 * ~4.5MB serverless body cap still upload. Falls back to multipart locally.
 */

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

export async function uploadBuyerFileFromUri(opts: {
  localUri: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}): Promise<{ url: string }> {
  if (typeof opts.fileSize === "number" && opts.fileSize > MAX_BUYER_FILE_BYTES) {
    throw { error: "Each file must be under 250MB.", status: 400 };
  }
  const contentType = opts.mimeType || "image/jpeg";
  const filenameHint = opts.fileName || "photo.jpg";

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

  if (tokenRes.ok && tokenData.pathname && tokenData.clientToken && tokenData.contentType) {
    const fileRes = await fetch(opts.localUri);
    if (!fileRes.ok) throw { error: "Could not read the selected photo.", status: 0 };
    const blob = await fileRes.blob();
    const parts = tokenData.clientToken.split("_");
    const storeId = parts[3] ?? "";
    const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BLOB_PUT_TIMEOUT_MS);
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
      return { url: json.url };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (tokenData.code !== "USE_MULTIPART_FALLBACK" && tokenRes.status !== 503) {
    throw { error: tokenData.error || "Could not prepare upload", status: tokenRes.status };
  }

  const form = new FormData();
  form.append("file", {
    uri: opts.localUri,
    name: filenameHint,
    type: contentType,
  } as unknown as Blob);
  return apiUploadFile("/api/upload/buyer-file", form);
}
