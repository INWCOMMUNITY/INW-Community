import {
  consumeWixOAuthState,
  createWixOAuthState,
  persistWixInstall,
  prisma,
  readWixOAuthBrowserBindingHash,
  WixSiteOwnershipConflictError,
  type WixPublicConnection,
} from "database";
import { readWixAppConfig, type WixAppConfig } from "./config";
import {
  detectWixCatalogVersion,
  fetchWixSiteInfo,
  mintWixAccessToken,
  WixRequestError,
  type WixFetch,
} from "./client";
import {
  createWixBrowserBindingSecret,
  wixBrowserBindingMatches,
  hashWixBrowserBinding,
} from "./browser-binding";
import { WIX_OAUTH_AUTHORIZE_URL, WIX_OAUTH_STATE_TTL_MS } from "./constants";
import { createWixOAuthNonce, signWixOAuthState, verifyWixOAuthState } from "./oauth-state";

export type WixConnectDeps = {
  config?: WixAppConfig | null;
  fetchImpl?: WixFetch;
  now?: Date;
};

export type WixOAuthStateRejectReason =
  | "SIGNED_STATE_INVALID"
  | "BROWSER_BINDING_COOKIE_MISSING"
  | "BROWSER_BINDING_HASH_MISMATCH"
  | "BROWSER_BINDING_STATE_UNUSABLE"
  | "STATE_CONSUME_REJECTED";

export class WixConnectError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "invalid_callback"
      | "invalid_state"
      | "token_exchange"
      | "site_info"
      | "catalog_version"
      | "site_owned",
    readonly reason?: WixOAuthStateRejectReason
  ) {
    super(message);
    this.name = "WixConnectError";
  }
}

/**
 * Begin the Wix app installation OAuth flow.
 * Returns the authorization URL and a browser binding secret to store in a cookie.
 */
export async function beginWixConnect(
  memberId: string,
  deps: WixConnectDeps = {}
): Promise<{ authorizeUrl: string; browserBindingSecret: string }> {
  const config = deps.config === undefined ? readWixAppConfig() : deps.config;
  if (!config) throw new WixConnectError("Wix is not configured", "not_configured");

  const nonce = createWixOAuthNonce();
  const browserBindingSecret = createWixBrowserBindingSecret();
  const now = deps.now ?? new Date();
  const state = await signWixOAuthState({ memberId, nonce });

  await createWixOAuthState(prisma, {
    nonce,
    memberId,
    browserBindingHash: hashWixBrowserBinding(browserBindingSecret),
    expiresAt: new Date(now.getTime() + WIX_OAUTH_STATE_TTL_MS),
  });

  // Wix app installation URL
  const url = new URL(WIX_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("appId", config.appId);
  url.searchParams.set("redirectUrl", config.redirectUri);
  url.searchParams.set("state", state);

  return { authorizeUrl: url.toString(), browserBindingSecret };
}

/**
 * Complete the Wix OAuth callback after app installation.
 * Validates the state, mints tokens, fetches site info, and persists the connection.
 */
export async function completeWixOAuth(
  searchParams: URLSearchParams,
  deps: WixConnectDeps & { browserBindingSecret?: string | null } = {}
): Promise<WixPublicConnection> {
  const config = deps.config === undefined ? readWixAppConfig() : deps.config;
  if (!config) throw new WixConnectError("Wix is not configured", "not_configured");

  // Extract parameters from callback
  const instanceId = searchParams.get("instanceId");
  const state = searchParams.get("state");

  if (!instanceId || !state) {
    throw new WixConnectError("Invalid Wix callback", "invalid_callback");
  }

  // Verify signed state
  const verified = await verifyWixOAuthState(state);
  if (!verified) {
    throw new WixConnectError("Invalid Wix OAuth state", "invalid_state", "SIGNED_STATE_INVALID");
  }

  // Verify browser binding
  const browserBindingSecret = deps.browserBindingSecret ?? "";
  if (!browserBindingSecret) {
    throw new WixConnectError(
      "Invalid Wix OAuth state",
      "invalid_state",
      "BROWSER_BINDING_COOKIE_MISSING"
    );
  }

  const storedBindingHash = await readWixOAuthBrowserBindingHash(prisma, {
    nonce: verified.nonce,
    memberId: verified.memberId,
    now: deps.now,
  });
  if (!storedBindingHash) {
    throw new WixConnectError(
      "Invalid Wix OAuth state",
      "invalid_state",
      "BROWSER_BINDING_STATE_UNUSABLE"
    );
  }
  if (!wixBrowserBindingMatches(storedBindingHash, browserBindingSecret)) {
    throw new WixConnectError(
      "Invalid Wix OAuth state",
      "invalid_state",
      "BROWSER_BINDING_HASH_MISMATCH"
    );
  }

  // Consume the OAuth state (one-time use)
  const consumed = await consumeWixOAuthState(prisma, {
    nonce: verified.nonce,
    memberId: verified.memberId,
    now: deps.now,
  });
  if (consumed.status !== "ok") {
    throw new WixConnectError(
      "Invalid Wix OAuth state",
      "invalid_state",
      "STATE_CONSUME_REJECTED"
    );
  }

  // Mint access token using app credentials and instance ID
  let accessToken: string;
  try {
    const tokenResult = await mintWixAccessToken({
      appId: config.appId,
      appSecret: config.appSecret,
      instanceId,
      fetchImpl: deps.fetchImpl,
    });
    accessToken = tokenResult.accessToken;
  } catch {
    throw new WixConnectError("Wix token exchange failed", "token_exchange");
  }

  // Fetch site info
  let siteInfo: { siteId: string; instanceId: string; siteName: string | null };
  try {
    siteInfo = await fetchWixSiteInfo({
      accessToken,
      config,
      fetchImpl: deps.fetchImpl,
    });
  } catch {
    throw new WixConnectError("Wix site info could not be retrieved", "site_info");
  }

  // Detect catalog version. Unknown or unreachable versions fail the connect
  // instead of guessing V3 and calling the wrong catalog API.
  let catalogVersion: Awaited<ReturnType<typeof detectWixCatalogVersion>>;
  try {
    catalogVersion = await detectWixCatalogVersion({
      accessToken,
      config,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    const retryable = error instanceof WixRequestError && error.errorClass !== "PERMANENT";
    throw new WixConnectError(
      retryable
        ? "Wix catalog version could not be determined. Try connecting again."
        : "Wix catalog version could not be determined.",
      "catalog_version"
    );
  }

  console.info("WIX_OAUTH_SITE_VERIFIED", {
    attemptId: verified.nonce.slice(0, 8),
    siteId: siteInfo.siteId,
    instanceId: siteInfo.instanceId,
    catalogVersion,
  });

  // Persist the connection
  try {
    return await persistWixInstall(prisma, {
      memberId: verified.memberId,
      instanceId: siteInfo.instanceId,
      siteId: siteInfo.siteId,
      shopName: siteInfo.siteName,
      catalogVersion,
      defaultLocationId: config.defaultLocationId,
      connectedAt: deps.now,
    });
  } catch (error) {
    if (error instanceof WixSiteOwnershipConflictError) {
      throw new WixConnectError(
        "Wix site is already connected to another INW account.",
        "site_owned"
      );
    }
    throw error;
  }
}

/**
 * Get a fresh access token for a Wix connection.
 * Wix uses app-instance authentication, so we can mint tokens on-demand.
 */
export async function accessTokenForWixConnection(
  connection: { instanceId: string },
  deps: WixConnectDeps = {}
): Promise<string> {
  const config = deps.config === undefined ? readWixAppConfig() : deps.config;
  if (!config) throw new WixConnectError("Wix is not configured", "not_configured");

  const tokenResult = await mintWixAccessToken({
    appId: config.appId,
    appSecret: config.appSecret,
    instanceId: connection.instanceId,
    fetchImpl: deps.fetchImpl,
  });

  return tokenResult.accessToken;
}

/**
 * Convert a connection to a public-safe representation.
 */
export function toPublicWixConnection(connection: WixPublicConnection) {
  return {
    id: connection.id,
    instanceId: connection.instanceId,
    siteId: connection.siteId,
    shopName: connection.shopName,
    catalogVersion: connection.catalogVersion,
    generation: connection.generation,
    status: connection.status,
    defaultLocationId: connection.defaultLocationId,
    connectedAt: connection.connectedAt.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
  };
}
