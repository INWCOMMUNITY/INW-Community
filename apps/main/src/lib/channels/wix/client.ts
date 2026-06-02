import { WIX_API_BASE } from "./config";

/** Error carrying the HTTP status so callers can branch (e.g. 404 -> already deleted). */
export class WixApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "WixApiError";
    this.status = status;
    this.body = body;
  }
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

/** Wix error envelopes use { message, details: { applicationError: { description } } }. */
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as {
      message?: string;
      details?: { applicationError?: { description?: string }; validationError?: { fieldViolations?: { description?: string }[] } };
    };
    const appErr = b.details?.applicationError?.description;
    const fieldErr = b.details?.validationError?.fieldViolations?.[0]?.description;
    return appErr || fieldErr || b.message || `Wix API error (${status})`;
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  return `Wix API error (${status})`;
}

/**
 * Core Wix request. App access tokens go in the Authorization header *without* a Bearer prefix.
 * Retries once on 429 after a short backoff.
 */
async function wixRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  attempt = 0
): Promise<T> {
  const url = path.startsWith("http") ? path : `${WIX_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: accessToken,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    return wixRequest<T>(accessToken, path, init, attempt + 1);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new WixApiError(errorMessage(body, res.status), res.status, body);
  }
  return body as T;
}

export function wixGet<T>(accessToken: string, path: string): Promise<T> {
  return wixRequest<T>(accessToken, path, { method: "GET" });
}

export function wixJson<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PUT" | "PATCH",
  json: unknown
): Promise<T> {
  return wixRequest<T>(accessToken, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
}

export function wixDelete<T>(accessToken: string, path: string): Promise<T> {
  return wixRequest<T>(accessToken, path, { method: "DELETE" });
}
