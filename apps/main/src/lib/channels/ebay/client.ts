import {
  EBAY_ACCEPT_LANGUAGE,
  EBAY_API_BASE,
  EBAY_CONTENT_LANGUAGE,
  EBAY_MARKETPLACE_ID,
} from "./config";
import {
  EbayApiError,
  extractEbayWarnings,
  formatEbayApiErrorMessage,
  formatEbayErrorRow,
  type EbayErrorRow,
} from "./errors";

export { EbayApiError } from "./errors";
export { describeEbayThrownError, describeChannelSyncError, ebayErrorActionHint } from "./errors";

const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_RETRY_BACKOFF_MS = 1_100;

/** Parse Retry-After (seconds or HTTP-date) into a capped delay. */
export function parseRetryAfterMs(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header?.trim()) return null;
  const raw = header.trim();
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(asSeconds * 1000));
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, asDate - nowMs));
  }
  return null;
}

function retryDelayMs(res: Response, attempt: number): number {
  const fromHeader = parseRetryAfterMs(res.headers.get("retry-after") ?? res.headers.get("Retry-After"));
  if (fromHeader != null) return fromHeader;
  return DEFAULT_RETRY_BACKOFF_MS * (attempt + 1);
}

let lastEbayWarnings: EbayErrorRow[] = [];

/** Warnings from the most recent successful eBay REST call (cleared on read). */
export function takeEbayCallWarnings(): EbayErrorRow[] {
  const rows = lastEbayWarnings;
  lastEbayWarnings = [];
  return rows;
}

function noteSuccessWarnings(path: string, body: unknown): void {
  const warnings = extractEbayWarnings(body);
  lastEbayWarnings = warnings;
  if (warnings.length === 0) return;
  console.warn("[ebay] REST 200 with warnings", {
    path,
    warnings: warnings.map((row) => formatEbayErrorRow(row)),
  });
}

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

const EBAY_FETCH_TIMEOUT_MS = 20_000;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EBAY_FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
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
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      ...fetchInit,
      headers: { ...baseHeaders(accessToken, { contentLanguage }), ...(extraHeaders ?? {}) },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new EbayApiError(
      aborted ? `eBay request timed out after ${EBAY_FETCH_TIMEOUT_MS / 1000}s` : "eBay request failed",
      aborted ? 504 : 502,
      null,
      path
    );
  }
  if (isRetryableStatus(res.status) && attempt < 2) {
    await new Promise((r) => setTimeout(r, retryDelayMs(res, attempt)));
    return ebayRequest<T>(accessToken, path, init, attempt + 1);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    lastEbayWarnings = [];
    throw new EbayApiError(formatEbayApiErrorMessage(body, res.status, path), res.status, body, path);
  }
  noteSuccessWarnings(path, body);
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
    contentLanguage: opts?.contentLanguage ?? true,
  });
}

/** POST/PUT with no body (e.g. publish/withdraw). Includes Content-Language for write operations. */
export function ebayAction<T>(
  accessToken: string,
  path: string,
  method: "POST" | "PUT" | "DELETE" = "POST"
): Promise<T> {
  // eBay requires Content-Language on write operations (POST/PUT), not on DELETE
  const contentLanguage = method !== "DELETE";
  return ebayRequest<T>(accessToken, path, { method, contentLanguage });
}

/**
 * Fetch an inventory item by SKU to verify the current state after a write.
 * Returns null if the item doesn't exist (404).
 */
export async function ebayGetInventoryItem(
  accessToken: string,
  sku: string
): Promise<{
  availability?: { shipToLocationAvailability?: { quantity?: number } };
  product?: { aspects?: Record<string, string[]>; title?: string };
} | null> {
  try {
    return await ebayGet(accessToken, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
  } catch (e) {
    if (e instanceof EbayApiError && e.status === 404) return null;
    throw e;
  }
}
