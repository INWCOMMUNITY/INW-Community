/**
 * API client for Northwest Community backend.
 * Uses EXPO_PUBLIC_API_URL; in release builds always https://www.inwcommunity.com.
 * Token storage: SecureStore on native, AsyncStorage on web (platform-specific).
 */

import { Platform } from "react-native";
import { getToken, setToken, clearToken } from "./storage";

export { getToken, setToken, clearToken };

/** Called whenever the API layer clears the token (e.g. after 401 with invalid refresh). AuthContext can set this to sync member state. */
let onTokenCleared: (() => void) | null = null;
export function setOnTokenCleared(fn: (() => void) | null): void {
  onTokenCleared = fn;
}

async function clearTokenAndNotify(): Promise<void> {
  await clearToken();
  onTokenCleared?.();
}

/** Track app open for admin analytics (fire-and-forget, no auth required) */
export function trackAppOpen(): void {
  const source = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const url = `${API_BASE}/api/analytics/track`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "INWCommunity/1.0 (com.northwestcommunity.app; iOS)",
    },
    body: JSON.stringify({ event: "app_open", source }),
  }).catch(() => {});
}

const PRODUCTION_API_URL = "https://www.inwcommunity.com";

/** Base URL for API requests. Never relative – always use production if env is missing or invalid. No trailing slash. */
export const API_BASE = (() => {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? "";
  const url = (typeof raw === "string" ? raw : "").trim();
  // In release builds (e.g. TestFlight), always use production unless env is explicitly the production URL.
  // This avoids any .env or build cache supplying a wrong URL.
  const isRelease = typeof __DEV__ === "boolean" && !__DEV__;
  const isProductionUrl =
    url.startsWith("https://www.inwcommunity.com") || url === "https://www.inwcommunity.com";
  if (isRelease && (!url || !isProductionUrl)) {
    return PRODUCTION_API_URL;
  }
  const base = url.startsWith("http://") || url.startsWith("https://") ? url : PRODUCTION_API_URL;
  return base.replace(/\/+$/, "") || base;
})();

/** Browser-like headers for production so WAF/firewalls don't block app requests. */
const BROWSER_LIKE_HEADERS =
  API_BASE.includes("inwcommunity.com")
    ? { Origin: "https://www.inwcommunity.com", Referer: "https://www.inwcommunity.com/" }
    : {};

/** Timeout in ms – prevents indefinite hang when server is unreachable */
const FETCH_TIMEOUT_MS = 25000;

/** User-Agent so the server treats the app as a normal client (some hosts block missing or bot-like UA). */
const USER_AGENT = "INWCommunity/1.0 (com.northwestcommunity.app; iOS)";

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
          "Request timed out. Please check your internet connection and try again.",
        status: 0,
      };
    }
    throw { error: err.message ?? String(e), status: 0 };
  }
}

/** Result of attempting token refresh: new token issued, server said invalid, or network/transient failure. */
type RefreshResult = "refreshed" | "invalid" | "network_error";

async function tryRefresh(): Promise<RefreshResult> {
  const token = await getToken();
  if (!token) return "invalid";
  try {
    const url = `${API_BASE}/api/auth/refresh`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(API_BASE.includes("ngrok") ? { "ngrok-skip-browser-warning": "true" } : {}),
      ...(API_BASE.includes("loca.lt") ? { "Bypass-Tunnel-Reminder": "true" } : {}),
    };
    const res = await fetchWithTimeout(url, { method: "POST", headers });
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (res.ok && data.token) {
      await setToken(data.token);
      return "refreshed";
    }
    if (res.status === 401) return "invalid";
    return "network_error";
  } catch {
    return "network_error";
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
    "Accept": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (API_BASE.includes("inwcommunity.com")) {
    headers["Origin"] = "https://www.inwcommunity.com";
    headers["Referer"] = "https://www.inwcommunity.com/";
  }
  if (API_BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  else if (API_BASE.includes("loca.lt")) headers["Bypass-Tunnel-Reminder"] = "true";
  if (typeof options.headers === "object" &&
    options.headers !== null &&
    !(options.headers instanceof Headers)
  ) {
    Object.assign(headers, Object.fromEntries(
      Object.entries(options.headers).map(([k, v]) => [k, String(v)])
    ));
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const isNetworkFailure = (err: { error?: string; message?: string; status?: number }) => {
    const msg = err.error ?? err.message ?? "";
    return err.status === 0 || /network request failed|failed to fetch|could not connect|econnrefused|enotfound/i.test(msg);
  };
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { ...options, headers });
  } catch (e) {
    const err = e as { error?: string; message?: string; status?: number };
    if (isNetworkFailure(err)) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        res = await fetchWithTimeout(url, { ...options, headers });
      } catch (retryErr) {
        const re = retryErr as { error?: string; message?: string; status?: number };
        const msg = re.error ?? re.message ?? String(retryErr);
        throw {
          error: isNetworkFailure(re)
            ? "Can't reach the server. Check your internet connection (try Wi‑Fi if on cellular), then try again."
            : msg,
          status: 0,
        };
      }
    } else {
      throw {
        error: err.error ?? err.message ?? String(e),
        status: 0,
      };
    }
  }
  if (res.status === 401 && token) {
    const isRefreshRoute = path.includes("/api/auth/refresh");
    if (!isRefreshRoute) {
      const refreshResult = await tryRefresh();
      if (refreshResult === "refreshed") {
        return fetchWithAuth(path, options);
      }
      if (refreshResult === "network_error") {
        return res;
      }
    }
    await clearTokenAndNotify();
  }
  return res;
}

function parseError(res: Response, data: unknown): string {
  const raw = (data as { error?: string | unknown })?.error;
  if (raw != null) {
    if (typeof raw === "string") return sanitizeError(raw);
    if (typeof raw === "object") {
      const obj = raw as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      if (Array.isArray(obj.formErrors) && obj.formErrors[0]) return obj.formErrors[0];
      if (obj.fieldErrors && typeof obj.fieldErrors === "object") {
        const first = Object.values(obj.fieldErrors).flat().find(Boolean);
        if (first) return first;
      }
    }
  }
  if (res.status === 401) return "Please sign in.";
  if (res.status === 404) return "Not found.";
  if (res.status >= 500) return "Server error. Try again.";
  if (res.status === 0) return "Could not connect. Please check your internet connection and try again.";
  return `Request failed (${res.status})`;
}

const HTML_ERROR_MESSAGE =
  "The server returned a web page instead of app data. Please check your connection or try again later.";

/** Throw if the server returned HTML instead of JSON (e.g. redirect or error page). */
function ensureJsonResponse(res: Response): void {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    throw { error: HTML_ERROR_MESSAGE, status: res.status };
  }
}

/** Never use a response body as error message if it looks like HTML. */
function sanitizeError(error: string): string {
  const t = (error ?? "").trim();
  if (t.startsWith("<!") || t.startsWith("<html")) return HTML_ERROR_MESSAGE;
  return error;
}

/** Parse response body as JSON; avoid "Unexpected end of input" when body is empty. */
async function parseJsonResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    if (!res.ok) throw { error: parseError(res, {}), status: res.status };
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const msg = (e instanceof SyntaxError && e.message) ? e.message : String(e);
    throw { error: sanitizeError(msg), status: res.status };
  }
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  ensureJsonResponse(res);
  const data = await parseJsonResponse<T>(res);
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
  ensureJsonResponse(res);
  const data = await parseJsonResponse<T>(res);
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
  ensureJsonResponse(res);
  const data = await parseJsonResponse<T>(res);
  if (!res.ok) {
    throw { error: parseError(res, data), status: res.status };
  }
  return data as T;
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetchWithAuth(path, { method: "DELETE" });
  ensureJsonResponse(res);
  const data = await parseJsonResponse<T>(res);
  if (!res.ok) {
    throw { error: parseError(res, data), status: res.status };
  }
  return data as T;
}

/** Upload file via FormData. Does not set Content-Type (browser sets multipart boundary). */
export async function apiUploadFile(
  path: string,
  formData: FormData,
  extraHeaders?: Record<string, string>
): Promise<{ url: string }> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const doUpload = async (authToken: string | null) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    if (API_BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
    if (API_BASE.includes("loca.lt")) headers["Bypass-Tunnel-Reminder"] = "true";
    return fetchWithTimeout(url, { method: "POST", headers, body: formData });
  };
  let token = await getToken();
  let res = await doUpload(token);
  if (res.status === 401 && token) {
    const refreshResult = await tryRefresh();
    if (refreshResult === "refreshed") {
      token = await getToken();
      res = await doUpload(token);
    }
    if (res.status === 401 && refreshResult !== "network_error") await clearTokenAndNotify();
  }
  ensureJsonResponse(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { error: (data as { error?: string }).error ?? "Upload failed", status: res.status };
  }
  return data as { url: string };
}
