/**
 * Listing photo uploads: resize on-device, then PUT directly to Vercel Blob
 * (tiny token request first) so production is not limited by the ~4.5MB
 * serverless request body cap. Falls back to multipart /api/upload locally.
 */

import { Image } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { API_BASE, apiUploadFile, getToken } from "./api";
import { formatListingPhotoSizeLabel, MAX_LISTING_PHOTO_BYTES } from "./upload-limits";

const USER_AGENT = "INWCommunity/1.0 (com.northwestcommunity.app; iOS)";
const BLOB_PUT_TIMEOUT_MS = 180000;
const LISTING_PHOTO_MAX_EDGE = 3200;

async function fetchListingUploadClientToken(body: object): Promise<Response> {
  const url = `${API_BASE}/api/upload/listing/client-token`;
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

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err)
    );
  });
}

export async function prepareListingPhoto(uri: string): Promise<{ uri: string; type: string; name: string }> {
  try {
    const { width, height } = await getImageSize(uri);
    const longest = Math.max(width, height);
    const actions =
      longest > LISTING_PHOTO_MAX_EDGE
        ? width >= height
          ? [{ resize: { width: LISTING_PHOTO_MAX_EDGE } }]
          : [{ resize: { height: LISTING_PHOTO_MAX_EDGE } }]
        : [];
    const r = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: 0.92,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: r.uri, type: "image/jpeg", name: "photo.jpg" };
  } catch {
    return { uri, type: "image/jpeg", name: "photo.jpg" };
  }
}

async function putBlobFromUri(
  pathname: string,
  clientToken: string,
  contentType: string,
  localUri: string
): Promise<string> {
  const fileRes = await fetch(localUri);
  if (!fileRes.ok) {
    throw { error: "Could not read the selected photo.", status: 0 };
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
      throw { error: "Upload to storage failed", status: putRes.status };
    }
    const json = (await putRes.json()) as { url?: string };
    if (!json.url) {
      throw { error: "Upload succeeded but no URL returned", status: 500 };
    }
    return json.url;
  } catch (e) {
    const err = e as { name?: string };
    if (err?.name === "AbortError") {
      throw { error: "Upload timed out. Try again on Wi‑Fi.", status: 0 };
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function optimizeListingBlob(url: string): Promise<string> {
  const token = await getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/upload/listing/optimize`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string };
  if (res.ok && data.url) return data.url;
  return url;
}

export async function uploadListingPhotoFile(opts: {
  localUri: string;
  mimeType?: string;
  fileSize?: number;
}): Promise<{ url: string }> {
  if (typeof opts.fileSize === "number" && opts.fileSize > MAX_LISTING_PHOTO_BYTES) {
    throw {
      error: `Each photo must be under ${formatListingPhotoSizeLabel()}.`,
      status: 400,
    };
  }

  const prepared = await prepareListingPhoto(opts.localUri);
  const tokenRes = await fetchListingUploadClientToken({
    contentType: prepared.type,
    filenameHint: prepared.name,
  });
  const raw = await tokenRes.json().catch(() => ({}));

  if (tokenRes.ok) {
    const data = raw as { pathname?: string; clientToken?: string; contentType?: string };
    if (!data.pathname || !data.clientToken || !data.contentType) {
      throw { error: "Invalid upload token response", status: tokenRes.status };
    }
    const storedUrl = await putBlobFromUri(
      data.pathname,
      data.clientToken,
      data.contentType,
      prepared.uri
    );
    const url = await optimizeListingBlob(storedUrl);
    return { url };
  }

  const code = (raw as { code?: string }).code;
  const fallback = tokenRes.status === 503 && code === "USE_MULTIPART_FALLBACK";
  if (fallback) {
    const formData = new FormData();
    formData.append("file", {
      uri: prepared.uri,
      type: prepared.type,
      name: prepared.name,
    } as unknown as Blob);
    return apiUploadFile("/api/upload", formData);
  }

  const errField = (raw as { error?: unknown }).error;
  const msg =
    typeof errField === "string"
      ? errField
      : `Photo upload failed (${tokenRes.status})`;
  throw { error: msg, status: tokenRes.status };
}

export { MAX_LISTING_PHOTO_BYTES, formatListingPhotoSizeLabel };
