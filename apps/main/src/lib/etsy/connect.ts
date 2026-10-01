import {
  consumeEtsyOAuthState,
  createEtsyOAuthState,
  persistEtsyInstall,
  prisma,
  readEtsyOAuthBrowserBindingHash,
  rotateEtsyTokenMaterial,
  EtsyShopOwnershipConflictError,
  type EtsyPublicConnection,
} from "database";
import { encrypt, decrypt } from "@/lib/encrypt";
import { readEtsyAppConfig, type EtsyAppConfig } from "./config";
import {
  exchangeEtsyAuthorizationCode,
  fetchEtsyShopForUser,
  refreshEtsyAccessToken,
  type EtsyFetch,
} from "./client";
import {
  createEtsyBrowserBindingSecret,
  etsyBrowserBindingMatches,
  hashEtsyBrowserBinding,
} from "./browser-binding";
import { ETSY_OAUTH_CONNECT_URL, ETSY_OAUTH_STATE_TTL_MS } from "./constants";
import { createEtsyOAuthNonce, signEtsyOAuthState, verifyEtsyOAuthState } from "./oauth-state";
import { createEtsyCodeChallenge, createEtsyCodeVerifier } from "./pkce";
import { missingEtsyScopes, normalizeEtsyGrantedScopes } from "./scopes";

export type EtsyConnectDeps = {
  config?: EtsyAppConfig | null;
  fetchImpl?: EtsyFetch;
  now?: Date;
};

export type EtsyOAuthStateRejectReason =
  | "SIGNED_STATE_INVALID"
  | "BROWSER_BINDING_COOKIE_MISSING"
  | "BROWSER_BINDING_HASH_MISMATCH"
  | "BROWSER_BINDING_STATE_UNUSABLE"
  | "STATE_CONSUME_REJECTED";

export class EtsyConnectError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "invalid_callback"
      | "invalid_state"
      | "token_exchange"
      | "scopes"
      | "shop_identity"
      | "shop_owned",
    readonly reason?: EtsyOAuthStateRejectReason
  ) {
    super(message);
    this.name = "EtsyConnectError";
  }
}

export async function beginEtsyConnect(
  memberId: string,
  deps: EtsyConnectDeps = {}
): Promise<{ authorizeUrl: string; browserBindingSecret: string }> {
  const config = deps.config === undefined ? readEtsyAppConfig() : deps.config;
  if (!config) throw new EtsyConnectError("Etsy is not configured", "not_configured");

  const nonce = createEtsyOAuthNonce();
  const browserBindingSecret = createEtsyBrowserBindingSecret();
  const codeVerifier = createEtsyCodeVerifier();
  const codeChallenge = createEtsyCodeChallenge(codeVerifier);
  const now = deps.now ?? new Date();
  const state = await signEtsyOAuthState({ memberId, nonce });

  await createEtsyOAuthState(prisma, {
    nonce,
    memberId,
    browserBindingHash: hashEtsyBrowserBinding(browserBindingSecret),
    codeVerifierEncrypted: encrypt(codeVerifier),
    expiresAt: new Date(now.getTime() + ETSY_OAUTH_STATE_TTL_MS),
  });

  const url = new URL(ETSY_OAUTH_CONNECT_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { authorizeUrl: url.toString(), browserBindingSecret };
}

function callbackParams(searchParams: URLSearchParams): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (params[key] !== undefined) return null;
    params[key] = value;
  }
  return params;
}

export async function completeEtsyOAuth(
  searchParams: URLSearchParams,
  deps: EtsyConnectDeps & { browserBindingSecret?: string | null } = {}
): Promise<EtsyPublicConnection> {
  const config = deps.config === undefined ? readEtsyAppConfig() : deps.config;
  if (!config) throw new EtsyConnectError("Etsy is not configured", "not_configured");

  const params = callbackParams(searchParams);
  const code = params?.code ?? "";
  const state = params?.state ?? "";
  if (!params || !code || !state) {
    if (params?.error) {
      throw new EtsyConnectError("Invalid Etsy callback", "invalid_callback");
    }
    throw new EtsyConnectError("Invalid Etsy callback", "invalid_callback");
  }

  const verified = await verifyEtsyOAuthState(state);
  if (!verified) {
    throw new EtsyConnectError("Invalid Etsy OAuth state", "invalid_state", "SIGNED_STATE_INVALID");
  }

  const browserBindingSecret = deps.browserBindingSecret ?? "";
  if (!browserBindingSecret) {
    throw new EtsyConnectError(
      "Invalid Etsy OAuth state",
      "invalid_state",
      "BROWSER_BINDING_COOKIE_MISSING"
    );
  }

  const storedBindingHash = await readEtsyOAuthBrowserBindingHash(prisma, {
    nonce: verified.nonce,
    memberId: verified.memberId,
    now: deps.now,
  });
  if (!storedBindingHash) {
    throw new EtsyConnectError(
      "Invalid Etsy OAuth state",
      "invalid_state",
      "BROWSER_BINDING_STATE_UNUSABLE"
    );
  }
  if (!etsyBrowserBindingMatches(storedBindingHash, browserBindingSecret)) {
    throw new EtsyConnectError(
      "Invalid Etsy OAuth state",
      "invalid_state",
      "BROWSER_BINDING_HASH_MISMATCH"
    );
  }

  const consumed = await consumeEtsyOAuthState(prisma, {
    nonce: verified.nonce,
    memberId: verified.memberId,
    now: deps.now,
  });
  if (consumed.status !== "ok") {
    throw new EtsyConnectError(
      "Invalid Etsy OAuth state",
      "invalid_state",
      "STATE_CONSUME_REJECTED"
    );
  }

  let tokens;
  try {
    const codeVerifier = decrypt(consumed.codeVerifierEncrypted);
    tokens = await exchangeEtsyAuthorizationCode({
      code,
      codeVerifier,
      config,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
  } catch {
    throw new EtsyConnectError("Etsy token exchange failed", "token_exchange");
  }

  const grantedScopes = normalizeEtsyGrantedScopes(tokens.scope);
  if (missingEtsyScopes(grantedScopes, config.scopes).length > 0) {
    throw new EtsyConnectError("Etsy did not grant the required scopes", "scopes");
  }

  let identity;
  try {
    identity = await fetchEtsyShopForUser({
      etsyUserId: tokens.etsyUserId,
      accessToken: tokens.accessToken,
      config,
      fetchImpl: deps.fetchImpl,
    });
  } catch {
    throw new EtsyConnectError("Etsy shop identity could not be verified", "shop_identity");
  }

  if (identity.etsyUserId !== tokens.etsyUserId) {
    throw new EtsyConnectError("Etsy shop identity could not be verified", "shop_identity");
  }

  console.info("ETSY_OAUTH_SHOP_VERIFIED", {
    attemptId: verified.nonce.slice(0, 8),
    shopId: identity.shopId,
    etsyUserId: identity.etsyUserId,
  });

  try {
    return await persistEtsyInstall(prisma, {
      memberId: verified.memberId,
      etsyUserId: identity.etsyUserId,
      shopId: identity.shopId,
      shopName: identity.shopName,
      accessTokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: encrypt(tokens.refreshToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      grantedScopes,
      connectedAt: deps.now,
    });
  } catch (error) {
    if (error instanceof EtsyShopOwnershipConflictError) {
      throw new EtsyConnectError(
        "Etsy shop is already connected to another INW account.",
        "shop_owned"
      );
    }
    throw error;
  }
}

const REFRESH_SKEW_MS = 60_000;

/** In-process single-flight refresh per connection id (multi-worker still relies on rotate compare). */
const refreshInFlight = new Map<string, Promise<string>>();

async function refreshAccessTokenLocked(
  connection: {
    id: string;
    memberId: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
  },
  deps: EtsyConnectDeps,
  config: NonNullable<EtsyConnectDeps["config"]>,
  now: Date
): Promise<string> {
  // Re-read in case another worker already rotated while we waited.
  const latest = await prisma.etsyConnection.findFirst({
    where: { id: connection.id, memberId: connection.memberId, status: "ACTIVE" },
  });
  if (!latest) throw new EtsyConnectError("Etsy reauthorization is required", "token_exchange");
  if (latest.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > now.getTime()) {
    return decrypt(latest.accessTokenEncrypted);
  }
  if (latest.refreshTokenExpiresAt.getTime() <= now.getTime()) {
    throw new EtsyConnectError("Etsy reauthorization is required", "token_exchange");
  }

  const refreshToken = decrypt(latest.refreshTokenEncrypted);
  const refreshed = await refreshEtsyAccessToken({
    refreshToken,
    config,
    fetchImpl: deps.fetchImpl,
    now,
  });

  if (refreshed.status === "retry") {
    // One brief retry for transient/throttle on the token endpoint.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const again = await refreshEtsyAccessToken({
      refreshToken,
      config,
      fetchImpl: deps.fetchImpl,
      now: deps.now ?? new Date(),
    });
    if (again.status !== "refreshed") {
      throw new EtsyConnectError("Etsy reauthorization is required", "token_exchange");
    }
    return persistRefreshedTokens(latest, again.tokens);
  }
  if (refreshed.status !== "refreshed") {
    throw new EtsyConnectError("Etsy reauthorization is required", "token_exchange");
  }
  return persistRefreshedTokens(latest, refreshed.tokens);
}

async function persistRefreshedTokens(
  latest: {
    id: string;
    memberId: string;
    refreshTokenEncrypted: string;
    accessTokenEncrypted: string;
  },
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
    scope: string;
  }
): Promise<string> {
  const accessTokenEncrypted = encrypt(tokens.accessToken);
  const refreshTokenEncrypted = encrypt(tokens.refreshToken);
  const rotated = await rotateEtsyTokenMaterial(prisma, {
    memberId: latest.memberId,
    connectionId: latest.id,
    expectedRefreshTokenEncrypted: latest.refreshTokenEncrypted,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    grantedScopes: normalizeEtsyGrantedScopes(tokens.scope) || undefined,
  });
  if (!rotated) {
    const current = await prisma.etsyConnection.findFirst({
      where: { id: latest.id, memberId: latest.memberId, status: "ACTIVE" },
    });
    if (!current) throw new EtsyConnectError("Etsy reauthorization is required", "token_exchange");
    return decrypt(current.accessTokenEncrypted);
  }
  return tokens.accessToken;
}

export async function accessTokenForEtsyConnection(
  connection: {
    id: string;
    memberId: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
  },
  deps: EtsyConnectDeps = {}
): Promise<string> {
  const config = deps.config === undefined ? readEtsyAppConfig() : deps.config;
  if (!config) throw new EtsyConnectError("Etsy is not configured", "not_configured");
  const now = deps.now ?? new Date();
  if (connection.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > now.getTime()) {
    return decrypt(connection.accessTokenEncrypted);
  }
  if (connection.refreshTokenExpiresAt.getTime() <= now.getTime()) {
    throw new EtsyConnectError("Etsy reauthorization is required", "token_exchange");
  }

  const existing = refreshInFlight.get(connection.id);
  if (existing) return existing;

  const promise = refreshAccessTokenLocked(connection, deps, config, now).finally(() => {
    refreshInFlight.delete(connection.id);
  });
  refreshInFlight.set(connection.id, promise);
  return promise;
}

/** Test helper — clears in-process refresh single-flight map. */
export function clearEtsyRefreshInFlightForTests(): void {
  refreshInFlight.clear();
}

export function toPublicEtsyConnection(connection: EtsyPublicConnection) {
  return {
    id: connection.id,
    etsyUserId: connection.etsyUserId,
    shopId: connection.shopId,
    shopName: connection.shopName,
    generation: connection.generation,
    status: connection.status,
    grantedScopes: connection.grantedScopes.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    connectedAt: connection.connectedAt.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
  };
}
