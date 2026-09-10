import { shopAdminBase } from "./config";
import { waitForRateLimit } from "../rate-limit-tracker";

let currentConnectionId: string | null = null;

/** Set the current connection ID for rate limiting (call before making requests). */
export function setShopifyConnectionContext(connectionId: string): void {
  currentConnectionId = connectionId;
}

/** Error carrying the HTTP status so callers can branch (e.g. 404 -> already deleted). */
export class ShopifyApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ShopifyApiError";
    this.status = status;
    this.body = body;
  }
}

/** Shopify REST leak rate is 2 req/s; stay just under so other isolates have headroom. */
const SHOPIFY_MIN_INTERVAL_MS = 550;
const SHOPIFY_MAX_429_RETRIES = 6;
const SHOPIFY_MAX_RETRY_AFTER_MS = 15_000;
const SHOPIFY_MAX_LOCK_RETRIES = 3;

const shopChains = new Map<string, Promise<unknown>>();
const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shopKey(shop: string): string {
  return shop.trim().toLowerCase();
}

/**
 * Serialize Admin API calls per shop so parallel work cannot burst past Shopify's
 * 2 req/s REST client leak rate.
 */
function enqueueShop<T>(shop: string, fn: () => Promise<T>): Promise<T> {
  const key = shopKey(shop);
  const prev = shopChains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  shopChains.set(
    key,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}

/** Parse Retry-After (seconds or HTTP-date) into a capped delay. */
export function parseShopifyRetryAfterMs(
  header: string | null | undefined,
  nowMs = Date.now()
): number | null {
  if (!header?.trim()) return null;
  const raw = header.trim();
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(SHOPIFY_MAX_RETRY_AFTER_MS, Math.round(asSeconds * 1000));
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.min(SHOPIFY_MAX_RETRY_AFTER_MS, Math.max(0, asDate - nowMs));
  }
  return null;
}

/** Parse `X-Shopify-Shop-Api-Call-Limit: used/max`. */
export function parseShopifyCallLimit(
  header: string | null | undefined
): { used: number; max: number } | null {
  if (!header?.trim()) return null;
  const match = header.trim().match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const used = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return null;
  return { used, max };
}

/** Test helper: clear in-process Shopify request pacing. */
export function resetShopifyClientForTests(): void {
  shopChains.clear();
  lastRequestAt.clear();
  currentConnectionId = null;
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
    const b = body as { errors?: string | Record<string, string[]>; error?: string };
    if (typeof b.errors === "string") return b.errors;
    if (b.errors && typeof b.errors === "object") {
      const first = Object.values(b.errors)[0];
      if (Array.isArray(first) && first[0]) return first[0];
    }
    if (b.error) return b.error;
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  return `Shopify API error (${status})`;
}

/** Shopify 422 while another write (webhook, admin, or our own PUT) still holds the product. */
export function isShopifyConcurrentModification(status: number, message: string): boolean {
  return (
    status === 422 &&
    /currently being modified|please try again later/i.test(message)
  );
}

function rateLimitKey(shop: string): string {
  return currentConnectionId || `shop:${shopKey(shop)}`;
}

function retryAfterDelayMs(res: Response, attempt: number): number {
  const fromHeader = parseShopifyRetryAfterMs(
    res.headers.get("retry-after") ?? res.headers.get("Retry-After")
  );
  const base = fromHeader != null ? fromHeader : Math.min(2000 * (attempt + 1), 8000);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(SHOPIFY_MAX_RETRY_AFTER_MS, Math.max(250, base + jitter));
}

async function paceShopifyRequest(shop: string, recordWindow: boolean): Promise<void> {
  if (recordWindow) {
    await waitForRateLimit("shopify", rateLimitKey(shop));
  }
  const key = shopKey(shop);
  const elapsed = Date.now() - (lastRequestAt.get(key) ?? 0);
  if (elapsed < SHOPIFY_MIN_INTERVAL_MS) {
    await sleep(SHOPIFY_MIN_INTERVAL_MS - elapsed);
  }
  lastRequestAt.set(key, Date.now());
}

async function maybeBackoffFromCallLimit(res: Response): Promise<void> {
  const limit = parseShopifyCallLimit(res.headers.get("X-Shopify-Shop-Api-Call-Limit"));
  if (!limit) return;
  const remaining = limit.max - limit.used;
  if (remaining <= 2) {
    await sleep(SHOPIFY_MIN_INTERVAL_MS);
  }
}

type ShopifyAdminResult<T> = { data: T; nextUrl: string | null };

async function shopifyAdminRequestLocked<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  paceRest: boolean
): Promise<ShopifyAdminResult<T>> {
  const base = shopAdminBase(shop, apiVersion);
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  let throttleAttempt = 0;
  let lockAttempt = 0;

  while (true) {
    if (paceRest) {
      await paceShopifyRequest(shop, throttleAttempt === 0 && lockAttempt === 0);
    }
    const res = await fetch(url, {
      ...init,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 429 && throttleAttempt < SHOPIFY_MAX_429_RETRIES) {
      const delay = retryAfterDelayMs(res, throttleAttempt);
      console.warn("[shopify] rate limited; retrying", {
        path,
        attempt: throttleAttempt + 1,
        delayMs: delay,
        callLimit: res.headers.get("X-Shopify-Shop-Api-Call-Limit"),
      });
      await res.text().catch(() => "");
      await sleep(delay);
      throttleAttempt += 1;
      continue;
    }

    const body = await parseBody(res);
    if (!res.ok) {
      const msg = errorMessage(body, res.status);
      if (isShopifyConcurrentModification(res.status, msg) && lockAttempt < SHOPIFY_MAX_LOCK_RETRIES) {
        const waitMs = 1500 * (lockAttempt + 1);
        console.warn("[shopify] product locked; retrying", {
          path,
          attempt: lockAttempt + 1,
          waitMs,
        });
        await sleep(waitMs);
        lockAttempt += 1;
        continue;
      }
      throw new ShopifyApiError(msg, res.status, body);
    }

    await maybeBackoffFromCallLimit(res);
    return { data: body as T, nextUrl: parseShopifyNextUrl(res.headers.get("Link")) };
  }
}

function isGraphqlPath(path: string): boolean {
  return /(^|\/)graphql\.json(\?|$)/i.test(path);
}

async function shopifyRequest<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
): Promise<T> {
  // GraphQL still paces against the shop's rate window (waitForRateLimit + min interval) so it
  // can't burst past Shopify's limits, but it stays OUT of the per-shop serialization chain:
  // a GraphQL call made from inside an already-enqueued REST op would otherwise deadlock on the
  // chain that is awaiting it.
  const run = () =>
    shopifyAdminRequestLocked<T>(accessToken, shop, apiVersion, path, init, true);
  const result = isGraphqlPath(path) ? await run() : await enqueueShop(shop, run);
  return result.data;
}

export type ShopifyGetResult<T> = { data: T; nextUrl: string | null };

/** Parse Shopify REST `Link` header for rel="next" pagination. */
export function parseShopifyNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

export async function shopifyGetWithPagination<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string
): Promise<ShopifyGetResult<T>> {
  return enqueueShop(shop, () =>
    shopifyAdminRequestLocked<T>(accessToken, shop, apiVersion, path, { method: "GET" }, true)
  );
}

export function shopifyGet<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string
): Promise<T> {
  return shopifyRequest<T>(accessToken, shop, apiVersion, path, { method: "GET" });
}

export function shopifyJson<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string,
  method: "POST" | "PUT",
  json: unknown
): Promise<T> {
  return shopifyRequest<T>(accessToken, shop, apiVersion, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
}

export function shopifyDelete<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string
): Promise<T> {
  return shopifyRequest<T>(accessToken, shop, apiVersion, path, { method: "DELETE" });
}

export type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: { message?: string }[];
};

/**
 * POST /admin/api/{version}/graphql.json
 * Throws ShopifyApiError when HTTP fails or the payload contains GraphQL errors
 * without usable data.
 */
export async function shopifyGraphql<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const body = await shopifyRequest<ShopifyGraphqlResponse<T>>(
    accessToken,
    shop,
    apiVersion,
    "/graphql.json",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    }
  );
  const gqlErrors = body.errors?.map((e) => e.message).filter(Boolean) ?? [];
  if (!body.data) {
    throw new ShopifyApiError(
      gqlErrors[0] || "Shopify GraphQL returned no data.",
      200,
      body
    );
  }
  if (gqlErrors.length > 0) {
    console.warn("[shopify] graphql user-facing errors", { errors: gqlErrors.slice(0, 3) });
  }
  return body.data;
}
