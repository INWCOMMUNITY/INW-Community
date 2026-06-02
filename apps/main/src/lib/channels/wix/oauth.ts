import { WIX_API_BASE, WIX_INSTALL_BASE, WIX_TOKEN_URL, getWixConfig } from "./config";
import type { TokenResponse } from "../types";

/**
 * Build the Wix App install URL. Wix uses the External Install Flow: the seller installs the app on
 * their site, then Wix redirects to the app's configured redirect URL with `instanceId`/`tenantId`.
 * We embed our signed `state` in `postInstallationUrl` so the dedicated callback can recover the
 * member id (Wix preserves the query we pass). `codeChallenge` is unused (no PKCE / no code grant).
 */
export function getWixAuthUrl(args: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { appId } = getWixConfig();
  const postInstallationUrl = `${args.redirectUri}?state=${encodeURIComponent(args.state)}`;
  const params = new URLSearchParams({
    appId,
    postInstallationUrl,
  });
  return `${WIX_INSTALL_BASE}?${params.toString()}`;
}

type WixTokenPayload = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  message?: string;
};

/**
 * Mint a short-lived (4h) app access token for a specific site installation. Wix app tokens are
 * minted on demand via client_credentials + the site's `instanceId` (there is no refresh token).
 */
export async function mintWixToken(instanceId: string): Promise<TokenResponse> {
  const { appId, appSecret } = getWixConfig();
  const res = await fetch(WIX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
      instance_id: instanceId,
    }),
  });
  const data = (await res.json().catch(() => null)) as WixTokenPayload | null;
  if (!res.ok || !data || data.error || !data.access_token) {
    const msg =
      data?.error_description || data?.error || data?.message || `Wix token request failed (${res.status})`;
    throw new Error(msg);
  }
  return {
    accessToken: data.access_token,
    // We persist the instanceId as the "refresh token" so connection.ts re-mints transparently.
    refreshToken: instanceId,
    expiresInSec: data.expires_in ?? 14_400,
    scopes: null,
  };
}

/**
 * "Refresh" = re-mint via the stored instanceId. connection.ts calls this with the decrypted
 * refresh token (which for Wix is the instanceId), so expired tokens are replaced transparently.
 */
export function refreshWixToken(instanceId: string): Promise<TokenResponse> {
  return mintWixToken(instanceId);
}

/** Wix never reaches the shared authorization-code callback; it has a dedicated install callback. */
export function exchangeWixCode(): Promise<TokenResponse> {
  return Promise.reject(
    new Error("Wix uses the install callback (instanceId), not an authorization code.")
  );
}

/**
 * Optional site display name via Site Properties. The site GUID (tenantId) comes from the install
 * redirect, so connect doesn't depend on this; returns a best-effort name only.
 */
export async function fetchWixShopInfo(
  accessToken: string
): Promise<{ shopId: string; shopName: string | null }> {
  try {
    const res = await fetch(`${WIX_API_BASE}/site-properties/v4/properties`, {
      headers: { Authorization: accessToken, Accept: "application/json" },
    });
    const data = (await res.json().catch(() => null)) as
      | { properties?: { displayName?: string } }
      | null;
    return { shopId: "", shopName: data?.properties?.displayName ?? null };
  } catch {
    return { shopId: "", shopName: null };
  }
}
