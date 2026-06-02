import { EBAY_API_BASE, EBAY_CONTENT_LANGUAGE, EBAY_MARKETPLACE_ID } from "./config";

/** Error carrying the HTTP status so callers can branch (e.g. 404 -> already withdrawn). */
export class EbayApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "EbayApiError";
    this.status = status;
    this.body = body;
  }
}

function baseHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
    "Content-Language": EBAY_CONTENT_LANGUAGE,
    Accept: "application/json",
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

/** eBay error envelopes use { errors: [{ message, longMessage, errorId }] }. */
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as { errors?: { message?: string; longMessage?: string }[]; message?: string };
    const first = Array.isArray(b.errors) ? b.errors[0] : undefined;
    return first?.longMessage || first?.message || b.message || `eBay API error (${status})`;
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  return `eBay API error (${status})`;
}

/** Core eBay Sell request. Retries once on 429 after a short backoff. */
async function ebayRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  attempt = 0
): Promise<T> {
  const url = path.startsWith("http") ? path : `${EBAY_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...baseHeaders(accessToken), ...(init.headers ?? {}) },
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    return ebayRequest<T>(accessToken, path, init, attempt + 1);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new EbayApiError(errorMessage(body, res.status), res.status, body);
  }
  return body as T;
}

export function ebayGet<T>(accessToken: string, path: string): Promise<T> {
  return ebayRequest<T>(accessToken, path, { method: "GET" });
}

export function ebayJson<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PUT" | "PATCH",
  json: unknown
): Promise<T> {
  return ebayRequest<T>(accessToken, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
}

/** POST/PUT with no body (e.g. publish/withdraw). */
export function ebayAction<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PUT" | "DELETE" = "POST"
): Promise<T> {
  return ebayRequest<T>(accessToken, path, { method });
}
