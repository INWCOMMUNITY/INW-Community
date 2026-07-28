import { createHash, randomBytes } from "crypto";
import { ETSY_CONNECT_URL, ETSY_SCOPES, ETSY_TOKEN_URL, getEtsyConfig } from "./config";
import { etsyGet } from "./client";
import type { TokenResponse } from "../types";

/** base64url without padding. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function getEtsyAuthUrl(args: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { clientId } = getEtsyConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: args.redirectUri,
    scope: ETSY_SCOPES.join(" "),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_CONNECT_URL}?${params.toString()}`;
}

type EtsyTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
  /** Etsy includes the user_id in the token response. */
  user_id?: number;
  /** Etsy may include a session-specific API key. */
  api_key?: string;
  scope?: string;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => null)) as EtsyTokenPayload | null;
  // Log the full token response for debugging
  console.log("[etsy] token response keys:", data ? Object.keys(data) : "null");
  console.log("[etsy] token response user_id:", data?.user_id);
  console.log("[etsy] token response api_key:", data?.api_key);
  console.log("[etsy] token response scope:", data?.scope);
  if (!res.ok || !data || data.error || !data.access_token) {
    const msg = data?.error_description || data?.error || `Etsy token request failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: data.expires_in ?? null,
    userId: data.user_id != null ? String(data.user_id) : null,
    apiKey: data.api_key ?? null,
  };
}

export async function exchangeEtsyCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { clientId } = getEtsyConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: args.redirectUri,
      code: args.code,
      code_verifier: args.codeVerifier,
    })
  );
}

export async function refreshEtsyToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId } = getEtsyConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    })
  );
}

/**
 * Extract user_id from the Etsy access token.
 * Etsy access tokens have the format: user_id.token_string
 * (e.g., "12345678.VJTv9qyjwJbYlARxdFmEEQ")
 */
function extractUserIdFromToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    console.log("[etsy] token parts count:", parts.length);
    // Etsy tokens have format: user_id.token_string
    if (parts.length >= 2) {
      const userId = parts[0];
      // Verify it looks like a numeric user ID
      if (/^\d+$/.test(userId)) {
        console.log("[etsy] extracted user_id from token prefix:", userId);
        return userId;
      }
    }
    return null;
  } catch (e) {
    console.log("[etsy] token parse error:", String(e));
    return null;
  }
}

/**
 * Resolve the seller's shop id + name. If userId is provided (from the token response),
 * we skip /users/me (which may 403 on some apps) and go straight to /users/{id}/shops.
 * Otherwise tries to extract user_id from the JWT token, then falls back to /users/me.
 * If apiKey is provided (from token response), use it instead of the env var.
 */
export async function fetchEtsyShopInfo(
  accessToken: string,
  options?: { userId?: string; apiKey?: string }
): Promise<{ shopId: string; shopName: string | null }> {
  let userId = options?.userId;
  let shopId: string | null = null;
  const apiKey = options?.apiKey;

  console.log("[etsy] fetchEtsyShopInfo - userId:", userId, "apiKey provided:", !!apiKey);

  // Try to extract user_id from the JWT if not provided
  if (!userId) {
    userId = extractUserIdFromToken(accessToken) ?? undefined;
    if (userId) {
      console.log("[etsy] extracted user_id from JWT:", userId);
    }
  }

  // If we still don't have userId, try /users/me (may 403 on limited apps)
  if (!userId) {
    try {
      const me = await etsyGet<{ user_id?: number; shop_id?: number }>(accessToken, "/users/me", apiKey);
      console.log("[etsy] /users/me response:", JSON.stringify(me));
      if (me.shop_id) {
        shopId = String(me.shop_id);
        console.log("[etsy] got shop_id from /users/me:", shopId);
      }
      if (me.user_id) {
        userId = String(me.user_id);
        console.log("[etsy] got user_id from /users/me:", userId);
      }
    } catch (e) {
      // /users/me returned 403 or failed - we'll try other methods below
      console.warn("[etsy] /users/me failed, will try alternative methods", String(e));
      // Log config state for debugging
      try {
        const { apiKey: configApiKey, clientId } = getEtsyConfig();
        console.warn("[etsy] config check - apiKey length:", configApiKey?.length, "clientId length:", clientId?.length);
        console.warn("[etsy] using override apiKey:", apiKey ? "yes" : "no");
      } catch (configErr) {
        console.warn("[etsy] config error:", String(configErr));
      }
    }
  }

  // If we got a shop_id directly, fetch shop details
  if (shopId) {
    const shop = await etsyGet<{ shop_id: number; shop_name?: string }>(
      accessToken,
      `/shops/${shopId}`,
      apiKey
    ).catch(() => null);
    return { shopId, shopName: shop?.shop_name ?? null };
  }

  // If we have a user_id, fetch their shops
  if (userId) {
    try {
      console.log("[etsy] calling /users/" + userId + "/shops");
      const shops = await etsyGet<{ count?: number; results?: { shop_id: number; shop_name?: string }[] }>(
        accessToken,
        `/users/${userId}/shops`,
        apiKey
      );
      console.log("[etsy] /users/{id}/shops FULL response:", JSON.stringify(shops));
      const first = shops?.results?.[0];
      if (first?.shop_id) {
        return { shopId: String(first.shop_id), shopName: first.shop_name ?? null };
      }
      // If no results array, check if the response itself is a shop object
      if ((shops as any)?.shop_id) {
        const shopData = shops as any;
        console.log("[etsy] found shop directly in response:", shopData.shop_id);
        return { shopId: String(shopData.shop_id), shopName: shopData.shop_name ?? null };
      }
    } catch (e) {
      console.error("[etsy] /users/{id}/shops failed:", String(e));
    }
  }

  // Last resort: try to get the user's own shop via /shops/me (undocumented but sometimes works)
  try {
    console.log("[etsy] trying /shops endpoint as fallback");
    const myShops = await etsyGet<{ results?: { shop_id: number; shop_name?: string; user_id?: number }[] }>(
      accessToken,
      "/users/me/shops",
      apiKey
    ).catch(() => null);
    const first = myShops?.results?.[0];
    if (first?.shop_id) {
      console.log("[etsy] found shop via /users/me/shops:", first.shop_id, first.shop_name);
      return { shopId: String(first.shop_id), shopName: first.shop_name ?? null };
    }
  } catch (e) {
    console.warn("[etsy] /users/me/shops fallback failed:", String(e));
  }

  throw new Error("Could not resolve an Etsy shop for this account. Open a shop on Etsy first.");
}
