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

export type WixRequestOpts = {
  /** Site GUID (tenantId) from install callback — required for some site-level APIs. */
  siteId?: string | null;
};

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

/** Wix OAuth app tokens are documented with a Bearer Authorization prefix. */
function buildAuthHeader(accessToken: string, useBearer: boolean): string {
  const trimmed = accessToken.trim();
  if (useBearer) {
    return trimmed.startsWith("Bearer ") ? trimmed : `Bearer ${trimmed}`;
  }
  return trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
}

export function isWixMetasiteContextError(err: unknown): boolean {
  const msg =
    err instanceof WixApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return msg.includes("No Metasite Context") || msg.includes("MetaSite not found");
}

/**
 * Core Wix request. App access tokens go in Authorization (usually without Bearer).
 * Retries once on 429; on 401 retries once with Bearer prefix.
 */
async function wixRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  opts: WixRequestOpts = {},
  attempt = 0,
  authVariant: 0 | 1 = 1
): Promise<T> {
  const url = path.startsWith("http") ? path : `${WIX_API_BASE}${path}`;
  const siteId = opts.siteId?.trim();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(accessToken, authVariant === 1),
      Accept: "application/json",
      ...(siteId ? { "wix-site-id": siteId } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    return wixRequest<T>(accessToken, path, init, opts, attempt + 1, authVariant);
  }
  const body = await parseBody(res);
  if (res.status === 401 && authVariant === 0) {
    return wixRequest<T>(accessToken, path, init, opts, attempt, 1);
  }
  if (!res.ok) {
    throw new WixApiError(errorMessage(body, res.status), res.status, body);
  }
  return body as T;
}

export function wixGet<T>(accessToken: string, path: string, opts?: WixRequestOpts): Promise<T> {
  return wixRequest<T>(accessToken, path, { method: "GET" }, opts ?? {});
}

export function wixJson<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PUT" | "PATCH",
  json: unknown,
  opts?: WixRequestOpts
): Promise<T> {
  return wixRequest<T>(
    accessToken,
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    },
    opts ?? {}
  );
}

export function wixDelete<T>(accessToken: string, path: string, opts?: WixRequestOpts): Promise<T> {
  return wixRequest<T>(accessToken, path, { method: "DELETE" }, opts ?? {});
}
