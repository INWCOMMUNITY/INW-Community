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
 * Resolve the seller's shop id + name. Etsy's /users/me returns the user id (and shop_id
 * on newer responses); fall back to the user's shops collection if shop_id is absent.
 */
export async function fetchEtsyShopInfo(
  accessToken: string
): Promise<{ shopId: string; shopName: string | null }> {
  const me = await etsyGet<{ user_id?: number; shop_id?: number }>(accessToken, "/users/me");
  if (me.shop_id) {
    const shop = await etsyGet<{ shop_id: number; shop_name?: string }>(
      accessToken,
      `/shops/${me.shop_id}`
    ).catch(() => null);
    return { shopId: String(me.shop_id), shopName: shop?.shop_name ?? null };
  }
  if (me.user_id) {
    const shops = await etsyGet<{ results?: { shop_id: number; shop_name?: string }[] }>(
      accessToken,
      `/users/${me.user_id}/shops`
    ).catch(() => null);
    const first = shops?.results?.[0];
    if (first?.shop_id) {
      return { shopId: String(first.shop_id), shopName: first.shop_name ?? null };
    }
  }
  throw new Error("Could not resolve an Etsy shop for this account. Open a shop on Etsy first.");
}
