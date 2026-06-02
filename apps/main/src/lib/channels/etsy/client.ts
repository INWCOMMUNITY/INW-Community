import { ETSY_API_BASE, getEtsyConfig } from "./config";

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

function baseHeaders(accessToken: string): Record<string, string> {
  const { apiKey } = getEtsyConfig();
  return {
    "x-api-key": apiKey,
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

/**
 * Core Etsy request. Retries once on 429 (rate limit; Etsy allows ~10 req/s) after a short backoff.
 */
async function etsyRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  attempt = 0
): Promise<T> {
  const res = await fetch(`${ETSY_API_BASE}${path}`, {
    ...init,
    headers: { ...baseHeaders(accessToken), ...(init.headers ?? {}) },
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    return etsyRequest<T>(accessToken, path, init, attempt + 1);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new EtsyApiError(errorMessage(body, res.status), res.status, body);
  }
  return body as T;
}

export function etsyGet<T>(accessToken: string, path: string): Promise<T> {
  return etsyRequest<T>(accessToken, path, { method: "GET" });
}

/** POST/PATCH with application/x-www-form-urlencoded (Etsy listing create/update format). */
export function etsyForm<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  fields: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
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
