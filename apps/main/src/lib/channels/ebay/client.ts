import {
  EBAY_ACCEPT_LANGUAGE,
  EBAY_API_BASE,
  EBAY_CONTENT_LANGUAGE,
  EBAY_MARKETPLACE_ID,
} from "./config";
import { EbayApiError, formatEbayApiErrorMessage } from "./errors";

export { EbayApiError } from "./errors";
export { describeEbayThrownError, describeChannelSyncError, ebayErrorActionHint } from "./errors";

function baseHeaders(accessToken: string, opts?: { contentLanguage?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
    Accept: "application/json",
    // eBay rejects browser-style values like "en-US,en;q=0.9"; pin a simple locale tag.
    "Accept-Language": EBAY_ACCEPT_LANGUAGE,
  };
  if (opts?.contentLanguage) {
    headers["Content-Language"] = EBAY_CONTENT_LANGUAGE;
  }
  return headers;
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
}

/** Core eBay Sell request. Retries transient 429/5xx once after a short backoff. */
async function ebayRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string>; contentLanguage?: boolean } = {},
  attempt = 0
): Promise<T> {
  const url = path.startsWith("http") ? path : `${EBAY_API_BASE}${path}`;
  const { contentLanguage, headers: extraHeaders, ...fetchInit } = init;
  const res = await fetch(url, {
    ...fetchInit,
    headers: { ...baseHeaders(accessToken, { contentLanguage }), ...(extraHeaders ?? {}) },
  });
  if (isRetryableStatus(res.status) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    return ebayRequest<T>(accessToken, path, init, attempt + 1);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new EbayApiError(formatEbayApiErrorMessage(body, res.status), res.status, body);
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
  json: unknown,
  opts?: { contentLanguage?: boolean }
): Promise<T> {
  return ebayRequest<T>(accessToken, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
    contentLanguage: opts?.contentLanguage ?? !path.includes("bulk_migrate_listing"),
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
