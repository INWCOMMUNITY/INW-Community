/**
 * API client for Northwest Community backend.
 * Uses EXPO_PUBLIC_API_URL (or default localhost) for the base URL.
 * Token storage: SecureStore on native, AsyncStorage on web (platform-specific).
 */

import { getToken, setToken, clearToken } from "./storage";

export { getToken, setToken, clearToken };

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

/** Timeout in ms – prevents indefinite hang when server is unreachable */
const FETCH_TIMEOUT_MS = 15000;

export interface ApiError {
  error: string;
  status: number;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    const err = e as { name?: string; message?: string };
    if (err.name === "AbortError") {
      throw {
        error:
          "Request timed out. Ensure the site is running (pnpm dev:main) and your phone is on the same WiFi.",
        status: 0,
      };
    }
    throw { error: err.message ?? String(e), status: 0 };
  }
}

async function fetchWithAuth(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Bypass tunnel interstitials for API requests
    ...(API_BASE.includes("ngrok")
      ? { "ngrok-skip-browser-warning": "true" }
      : API_BASE.includes("loca.lt")
        ? { "Bypass-Tunnel-Reminder": "true" }
        : {}),
    ...(typeof options.headers === "object" &&
    options.headers !== null &&
    !(options.headers instanceof Headers)
      ? Object.fromEntries(
          Object.entries(options.headers).map(([k, v]) => [k, String(v)])
        )
      : {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { ...options, headers });
  } catch (e) {
    const err = e as { error?: string; status?: number };
    throw err.error ? err : { error: String(e), status: 0 };
  }
  // Only clear token when we sent one and got 401 (invalid/expired token).
  // Don't clear when we had no token - avoids cascading logouts from other requests.
  if (res.status === 401 && token) {
    await clearToken();
  }
  return res;
}

function parseError(res: Response, data: unknown): string {
  const raw = (data as { error?: string | unknown })?.error;
  if (raw != null) {
    if (typeof raw === "string") return raw;
    if (typeof raw === "object" && "formErrors" in (raw as object)) {
      const form = (raw as { formErrors?: string[] }).formErrors;
      if (Array.isArray(form) && form[0]) return form[0];
    }
  }
  if (res.status === 401) return "Please sign in to comment.";
  if (res.status === 404) return "Post not found.";
  if (res.status >= 500) return "Server error. Try again.";
  if (res.status === 0) return "Cannot connect. Check your network.";
  return `Request failed (${res.status})`;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { error: parseError(res, data), status: res.status };
  }
  return data as T;
}

export async function apiPost<T = unknown>(
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetchWithAuth(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { error: parseError(res, data), status: res.status };
  }
  return data as T;
}

export async function apiPatch<T = unknown>(
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetchWithAuth(path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { error: (data as { error?: string }).error ?? "Request failed", status: res.status };
  }
  return data as T;
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetchWithAuth(path, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { error: (data as { error?: string }).error ?? "Request failed", status: res.status };
  }
  return data as T;
}

/** Upload file via FormData. Does not set Content-Type (browser sets multipart boundary). */
export async function apiUploadFile(
  path: string,
  formData: FormData
): Promise<{ url: string }> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (API_BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  if (API_BASE.includes("loca.lt")) headers["Bypass-Tunnel-Reminder"] = "true";
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: "POST", headers, body: formData });
  } catch (e) {
    const err = e as { error?: string; status?: number };
    throw err.error ? err : { error: String(e), status: 0 };
  }
  if (res.status === 401 && token) await clearToken();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { error: (data as { error?: string }).error ?? "Upload failed", status: res.status };
  }
  return data as { url: string };
}
