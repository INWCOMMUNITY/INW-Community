import { shopAdminBase } from "./config";

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

async function shopifyRequest<T>(
  accessToken: string,
  shop: string,
  apiVersion: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  attempt = 0
): Promise<T> {
  const base = shopAdminBase(shop, apiVersion);
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429 && attempt < 2) {
    const retryAfter = Number(res.headers.get("Retry-After") || "2");
    await new Promise((r) => setTimeout(r, (retryAfter + attempt) * 1000));
    return shopifyRequest<T>(accessToken, shop, apiVersion, path, init, attempt + 1);
  }
  const body = await parseBody(res);
  if (!res.ok) {
    throw new ShopifyApiError(errorMessage(body, res.status), res.status, body);
  }
  return body as T;
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
  const base = shopAdminBase(shop, apiVersion);
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
    },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new ShopifyApiError(errorMessage(body, res.status), res.status, body);
  }
  return { data: body as T, nextUrl: parseShopifyNextUrl(res.headers.get("Link")) };
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
