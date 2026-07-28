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
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => null)) as EtsyTokenPayload | null;
  if (!res.ok || !data || data.error || !data.access_token) {
    const msg = data?.error_description || data?.error || `Etsy token request failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: data.expires_in ?? null,
    userId: data.user_id != null ? String(data.user_id) : null,
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
 * Try to extract user_id from the Etsy access token (JWT).
 * Etsy tokens are JWTs with the user_id in the payload.
 */
function extractUserIdFromToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    if (payload.user_id) return String(payload.user_id);
    if (payload.sub) return String(payload.sub);
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the seller's shop id + name. If userId is provided (from the token response),
 * we skip /users/me (which may 403 on some apps) and go straight to /users/{id}/shops.
 * Otherwise tries to extract user_id from the JWT token, then falls back to /users/me.
 */
export async function fetchEtsyShopInfo(
  accessToken: string,
  options?: { userId?: string }
): Promise<{ shopId: string; shopName: string | null }> {
  let userId = options?.userId;
  let shopId: string | null = null;

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
      const me = await etsyGet<{ user_id?: number; shop_id?: number }>(accessToken, "/users/me");
      if (me.shop_id) {
        shopId = String(me.shop_id);
      }
      if (me.user_id) {
        userId = String(me.user_id);
      }
    } catch (e) {
      // /users/me returned 403 or failed - we'll try other methods below
      console.warn("[etsy] /users/me failed, will try alternative methods", String(e));
    }
  }

  // If we got a shop_id directly, fetch shop details
  if (shopId) {
    const shop = await etsyGet<{ shop_id: number; shop_name?: string }>(
      accessToken,
      `/shops/${shopId}`
    ).catch(() => null);
    return { shopId, shopName: shop?.shop_name ?? null };
  }

  // If we have a user_id, fetch their shops
  if (userId) {
    const shops = await etsyGet<{ results?: { shop_id: number; shop_name?: string }[] }>(
      accessToken,
      `/users/${userId}/shops`
    ).catch(() => null);
    const first = shops?.results?.[0];
    if (first?.shop_id) {
      return { shopId: String(first.shop_id), shopName: first.shop_name ?? null };
    }
  }

  throw new Error("Could not resolve an Etsy shop for this account. Open a shop on Etsy first.");
}
