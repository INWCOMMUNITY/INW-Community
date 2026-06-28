import {
  EBAY_AUTH_URL,
  EBAY_SCOPES,
  EBAY_TOKEN_URL,
  EBAY_APIZ_BASE,
  getEbayConfig,
} from "./config";
import type { TokenResponse } from "../types";

/**
 * eBay authorize URL. Uses the authorization-code grant (no PKCE); `redirectUri` must be the
 * app's RuName. The signed `state` carries member id + app flag; `codeChallenge` is ignored.
 */
export function getEbayAuthUrl(args: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  /** Set to "login" to force the eBay sign-in screen (switch accounts). */
  prompt?: string;
}): string {
  const { clientId, ruName } = getEbayConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: args.redirectUri || ruName,
    scope: EBAY_SCOPES.join(" "),
    state: args.state,
  });
  if (args.prompt?.trim()) {
    params.set("prompt", args.prompt.trim());
  }
  return `${EBAY_AUTH_URL}?${params.toString()}`;
}

type EbayTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function basicAuthHeader(): string {
  const { clientId, clientSecret } = getEbayConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => null)) as EbayTokenPayload | null;
  if (!res.ok || !data || data.error || !data.access_token) {
    const msg = data?.error_description || data?.error || `eBay token request failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSec: data.expires_in ?? null,
    scopes: EBAY_SCOPES.join(" "),
  };
}

export async function exchangeEbayCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { ruName } = getEbayConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri || ruName,
    })
  );
}

export async function refreshEbayToken(refreshToken: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: EBAY_SCOPES.join(" "),
    })
  );
}

/** Resolve the seller's eBay username via the Commerce Identity API (apiz host). */
export async function fetchEbayShopInfo(
  accessToken: string
): Promise<{ shopId: string; shopName: string | null }> {
  const res = await fetch(`${EBAY_APIZ_BASE}/commerce/identity/v1/user/`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const data = (await res.json().catch(() => null)) as
    | { userId?: string; username?: string }
    | null;
  if (!res.ok || !data) {
    throw new Error(`Could not resolve eBay account (${res.status}).`);
  }
  const shopId = data.username || data.userId || "";
  if (!shopId) throw new Error("eBay account has no resolvable username.");
  return { shopId, shopName: data.username ?? null };
}
