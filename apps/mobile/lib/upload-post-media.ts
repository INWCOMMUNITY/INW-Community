/**
 * Post photo/video uploads: prefer Vercel Blob direct PUT (tiny token request first),
 * so production is not limited by the ~4.5MB Vercel serverless request body cap.
 * Falls back to multipart `/api/upload/post` when Blob is not configured (local dev).
 */

import { API_BASE, apiUploadFile, getToken } from "./api";

const USER_AGENT = "INWCommunity/1.0 (com.northwestcommunity.app; iOS)";
const BLOB_PUT_TIMEOUT_MS = 120000;

async function fetchPostUploadClientToken(body: object): Promise<Response> {
  const url = `${API_BASE}/api/upload/post/client-token`;
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    ...(API_BASE.includes("inwcommunity.com")
      ? {
          Origin: "https://www.inwcommunity.com",
          Referer: "https://www.inwcommunity.com/",
        }
      : {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (API_BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  if (API_BASE.includes("loca.lt")) headers["Bypass-Tunnel-Reminder"] = "true";

  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function putBlobFromUri(
  pathname: string,
  clientToken: string,
  contentType: string,
  localUri: string
): Promise<string> {
  const fileRes = await fetch(localUri);
  if (!fileRes.ok) {
    throw { error: "Could not read the selected file.", status: 0 };
  }
  const blob = await fileRes.blob();

  const parts = clientToken.split("_");
  const storeId = parts[3] ?? "";
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

  const putUrl = `https://blob.vercel-storage.com/${pathname}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BLOB_PUT_TIMEOUT_MS);
  try {
    const putRes = await fetch(putUrl, {
      method: "PUT",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${clientToken}`,
        "x-api-version": "7",
        "x-api-blob-request-id": requestId,
        "x-api-blob-request-attempt": "0",
        "x-content-type": contentType,
      },
      body: blob,
    });
    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => "");
      throw {
        error: errText.slice(0, 200) || "Upload to storage failed",
        status: putRes.status,
      };
    }
    const json = (await putRes.json()) as { url?: string };
    if (!json.url) {
      throw { error: "Upload succeeded but no URL returned", status: 500 };
    }
    return json.url;
  } catch (e) {
    const err = e as { name?: string };
    if (err?.name === "AbortError") {
      throw {
        error: "Upload timed out. Try a shorter clip or use Wi‑Fi.",
        status: 0,
      };
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadPostMediaFile(opts: {
  localUri: string;
  uploadKind: "image" | "video";
  mimeType: string;
  multipartFileName: string;
}): Promise<{ url: string }> {
  const tokenRes = await fetchPostUploadClientToken({
    uploadKind: opts.uploadKind,
    contentType: opts.mimeType,
    filenameHint: opts.multipartFileName,
  });

  const raw = await tokenRes.json().catch(() => ({}));

  if (tokenRes.ok) {
    const data = raw as { pathname?: string; clientToken?: string; contentType?: string };
    if (!data.pathname || !data.clientToken || !data.contentType) {
      throw { error: "Invalid upload token response", status: tokenRes.status };
    }
    const url = await putBlobFromUri(
      data.pathname,
      data.clientToken,
      data.contentType,
      opts.localUri
    );
    return { url };
  }

  const code = (raw as { code?: string }).code;
  const fallback = tokenRes.status === 503 && code === "USE_MULTIPART_FALLBACK";
  if (fallback) {
    const formData = new FormData();
    formData.append("file", {
      uri: opts.localUri,
      type: opts.mimeType,
      name: opts.multipartFileName,
    } as unknown as Blob);
    formData.append("type", opts.uploadKind === "video" ? "video" : "image");
    return apiUploadFile("/api/upload/post", formData);
  }

  const errField = (raw as { error?: unknown }).error;
  const msg =
    typeof errField === "string"
      ? errField
      : typeof errField === "object" &&
          errField !== null &&
          "message" in errField &&
          typeof (errField as { message?: unknown }).message === "string"
        ? (errField as { message: string }).message
        : `Upload failed (${tokenRes.status})`;
  throw { error: msg, status: tokenRes.status };
}
