import { ETSY_API_BASE, getEtsyConfig } from "./config";
import { waitForRateLimit, recordRequest } from "../rate-limit-tracker";
import { recordDailyRequest } from "../daily-quota-tracker";

let currentConnectionId: string | null = null;

/** Set the current connection ID for rate limiting (call before making requests). */
export function setEtsyConnectionContext(connectionId: string): void {
  currentConnectionId = connectionId;
}

/** Error carrying the HTTP status so callers can branch (e.g. 404 -> already deleted). */
export class EtsyApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "EtsyApiError";
    this.status = status;
    this.body = body;
  }
}

function baseHeaders(accessToken: string, overrideApiKey?: string): Record<string, string> {
  const { apiKey, clientSecret } = getEtsyConfig();
  // Etsy requires x-api-key to be: <keystring>:<shared_secret>
  const combinedKey = overrideApiKey || `${apiKey}:${clientSecret}`;
  return {
    "x-api-key": combinedKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as { error?: string; error_description?: string; message?: string };
    return b.error_description || b.error || b.message || `Etsy API error (${status})`;
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  return `Etsy API error (${status})`;
}

/** Generate a short request ID for log correlation. */
function generateRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Core Etsy request. Uses proactive rate limiting and retries on 429.
 * Includes structured logging for debugging sync issues.
 */
export type EtsyRequestBehavior = {
  /** Treat HTTP 404 as a normal miss (no error log, returns null). */
  notFoundOk?: boolean;
};

async function etsyRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  attempt = 0,
  overrideApiKey?: string,
  behavior?: EtsyRequestBehavior
): Promise<T> {
  const requestId = generateRequestId();
  const method = (init.method as string) || "GET";
  const startTime = Date.now();

  if (currentConnectionId) {
    await waitForRateLimit("etsy", currentConnectionId);
  }

  // Log the request (redact sensitive data)
  console.log("[etsy:request]", {
    requestId,
    method,
    path,
    connectionId: currentConnectionId,
    attempt,
  });

  const res = await fetch(`${ETSY_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...baseHeaders(accessToken, overrideApiKey), ...(init.headers ?? {}) },
  });
  const elapsed = Date.now() - startTime;

  if (res.status === 429 && attempt < 2) {
    console.warn("[etsy:rate-limit]", {
      requestId,
      path,
      retryIn: 1100 * (attempt + 1),
      attempt,
    });
    await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    return etsyRequest<T>(accessToken, path, init, attempt + 1, overrideApiKey, behavior);
  }

  const body = await parseBody(res);

  if (!res.ok) {
    if (behavior?.notFoundOk && res.status === 404) {
      console.log("[etsy:not-found]", {
        requestId,
        method,
        path,
        elapsed,
      });
      return null as T;
    }
    const errMsg = errorMessage(body, res.status);
    console.error("[etsy:error]", {
      requestId,
      method,
      path,
      status: res.status,
      error: errMsg,
      elapsed,
      // Include body details for debugging (truncated)
      bodyPreview: typeof body === "object" ? JSON.stringify(body).slice(0, 500) : String(body).slice(0, 200),
    });
    throw new EtsyApiError(errMsg, res.status, body);
  }

  // Log successful response and track daily quota
  console.log("[etsy:response]", {
    requestId,
    method,
    path,
    status: res.status,
    elapsed,
  });
  
  // Track daily quota usage
  recordDailyRequest("etsy");

  return body as T;
}

export type EtsyGetOptions = EtsyRequestBehavior & { overrideApiKey?: string };

export function etsyGet<T>(
  accessToken: string,
  path: string,
  options?: string | EtsyGetOptions
): Promise<T> {
  const opts: EtsyGetOptions =
    typeof options === "string" ? { overrideApiKey: options } : options ?? {};
  return etsyRequest<T>(
    accessToken,
    path,
    { method: "GET" },
    0,
    opts.overrideApiKey,
    { notFoundOk: opts.notFoundOk }
  );
}

/** POST/PATCH with application/x-www-form-urlencoded (Etsy listing create/update format). */
export function etsyForm<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  fields: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  const body = new URLSearchParams();
  const fieldKeys: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
    fieldKeys.push(k);
  }
  if (path.includes("/listings")) {
    console.log("[etsy:form]", { method, path, fieldKeys });
  }
  return etsyRequest<T>(accessToken, path, {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

/** PUT/POST with a JSON body (Etsy inventory update uses JSON). */
export function etsyJson<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  json: unknown
): Promise<T> {
  return etsyRequest<T>(accessToken, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
}

export function etsyDelete<T>(accessToken: string, path: string): Promise<T> {
  return etsyRequest<T>(accessToken, path, { method: "DELETE" });
}

/** Upload one image (multipart) to a listing. Fetches the bytes from the given URL first. */
export async function etsyUploadImage(
  accessToken: string,
  shopId: string,
  listingId: string,
  imageUrl: string,
  rank: number
): Promise<void> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch image for Etsy upload: ${imageUrl}`);
  const arrayBuf = await imgRes.arrayBuffer();
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const form = new FormData();
  form.append("image", new Blob([arrayBuf], { type: contentType }), `photo-${rank}.jpg`);
  form.append("rank", String(rank));
  const res = await fetch(
    `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/images`,
    { method: "POST", headers: baseHeaders(accessToken), body: form }
  );
  if (!res.ok) {
    const body = await parseBody(res);
    throw new EtsyApiError(errorMessage(body, res.status), res.status, body);
  }
}
