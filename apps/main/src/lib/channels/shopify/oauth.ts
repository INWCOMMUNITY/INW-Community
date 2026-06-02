import { createHmac, timingSafeEqual } from "crypto";
import {
  getShopifyConfig,
  normalizeShopDomain,
  SHOPIFY_SCOPES,
} from "./config";
import type { TokenResponse } from "../types";

/** Build the per-shop OAuth authorize URL (offline access token; no grant_options[]=per-user). */
export function getShopifyAuthUrl(args: {
  shop: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { apiKey } = getShopifyConfig();
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SHOPIFY_SCOPES.join(","),
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `https://${args.shop}/admin/oauth/authorize?${params.toString()}`;
}

type ShopifyTokenPayload = {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

/**
 * Exchange the authorization code for a non-expiring offline Admin API access token.
 * `codeChallenge` is unused (Shopify does not use PKCE for this flow).
 */
export async function exchangeShopifyCode(args: {
  shop?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const shop = args.shop ? normalizeShopDomain(args.shop) : null;
  if (!shop) throw new Error("Invalid Shopify shop domain.");
  const { apiKey, apiSecret } = getShopifyConfig();
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code: args.code,
      expiring: 0,
    }),
  });
  const data = (await res.json().catch(() => null)) as ShopifyTokenPayload | null;
  if (!res.ok || !data || data.error || !data.access_token) {
    const msg =
      data?.error_description || data?.error || `Shopify token request failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresInSec: null,
    scopes: data.scope || SHOPIFY_SCOPES.join(","),
  };
}

/** Non-expiring offline tokens do not refresh; reconnect if revoked. */
export async function refreshShopifyToken(): Promise<TokenResponse> {
  throw new Error("Shopify offline token expired or was revoked. Reconnect your Shopify store.");
}

/**
 * Verify the Shopify OAuth callback query HMAC before exchanging the code.
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 */
export function verifyShopifyCallbackHmac(
  searchParams: URLSearchParams,
  secret?: string
): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;
  const apiSecret = secret ?? getShopifyConfig().apiSecret;
  const pairs: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("&");
  const digest = createHmac("sha256", apiSecret).update(message).digest("hex");
  try {
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(hmac, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Resolve shop display name via Admin API (requires shop host). */
export async function fetchShopifyShopInfo(
  accessToken: string,
  shop: string
): Promise<{ shopId: string; shopName: string | null }> {
  const normalized = normalizeShopDomain(shop);
  if (!normalized) throw new Error("Invalid Shopify shop domain.");
  const { apiVersion } = getShopifyConfig();
  const res = await fetch(`https://${normalized}/admin/api/${apiVersion}/shop.json`, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
    },
  });
  const data = (await res.json().catch(() => null)) as { shop?: { name?: string } } | null;
  if (!res.ok || !data?.shop) {
    return { shopId: normalized, shopName: null };
  }
  return { shopId: normalized, shopName: data.shop.name ?? null };
}
