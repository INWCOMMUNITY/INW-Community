import {
  consumeShopifyOAuthState,
  createShopifyOAuthState,
  persistShopifyInstall,
  prisma,
  readShopifyOAuthBrowserBindingHash,
  rotateShopifyTokenMaterial,
  ShopifyShopOwnershipConflictError,
  type ShopifyPublicConnection,
} from "database";
import { encrypt, decrypt } from "@/lib/encrypt";
import { readShopifyAppConfig, type ShopifyAppConfig } from "./config";
import {
  exchangeShopifyAuthorizationCode,
  fetchShopifyLocations,
  fetchShopifyShopIdentity,
  refreshShopifyOfflineToken,
  registerShopifyUninstallWebhook,
  ensureShopifyProductsUpdateWebhook,
  ensureShopifyOrdersPaidWebhook,
  ShopifyDomainAssociationError,
  type ShopifyFetch,
} from "./client";
import { verifyShopifyOAuthHmac } from "./hmac";
import { selectInventoryLocations } from "./locations";
import {
  createShopifyOAuthNonce,
  signShopifyOAuthState,
  verifyShopifyOAuthState,
} from "./oauth-state";
import { SHOPIFY_OAUTH_STATE_TTL_MS } from "./constants";
import { missingShopifyScopes } from "./scopes";
import {
  createShopifyBrowserBindingSecret,
  hashShopifyBrowserBinding,
  shopifyBrowserBindingMatches,
} from "./browser-binding";
import { normalizeShopifyShopDomain } from "./shop-domain";

export type ShopifyConnectDeps = {
  config?: ShopifyAppConfig | null;
  fetchImpl?: ShopifyFetch;
  now?: Date;
};

/** Non-secret rejection reasons for OAuth state/browser-binding / shop-association failures. */
export type ShopifyOAuthStateRejectReason =
  | "SIGNED_STATE_INVALID"
  | "SIGNED_STATE_SHOP_MISMATCH"
  | "BROWSER_BINDING_COOKIE_MISSING"
  | "BROWSER_BINDING_HASH_MISMATCH"
  | "BROWSER_BINDING_STATE_UNUSABLE"
  | "STATE_CONSUME_REJECTED"
  | "REQUESTED_SHOP_NOT_ASSOCIATED"
  | "SHOP_DOMAIN_ASSOCIATION_UNVERIFIED";

/** Non-secret shop-identity fields for SIGNED_STATE_SHOP_MISMATCH diagnostics. */
export type ShopifyConnectShopDiagnostic = {
  signedStateShop?: string;
  callbackShop?: string;
  rawCallbackShop?: string;
  /** Truncated nonce prefix for correlating connect→callback (not the signed state token). */
  attemptId?: string;
};

export class ShopifyConnectError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "invalid_shop"
      | "invalid_callback"
      | "invalid_state"
      | "shop_mismatch"
      | "token_exchange"
      | "scopes"
      | "shop_identity"
      | "shop_owned"
      | "webhook",
    readonly reason?: ShopifyOAuthStateRejectReason,
    readonly diagnostic?: ShopifyConnectShopDiagnostic
  ) {
    super(message);
    this.name = "ShopifyConnectError";
  }
}

export async function beginShopifyConnect(
  memberId: string,
  shopInput: string,
  deps: ShopifyConnectDeps = {}
): Promise<{ authorizeUrl: string; browserBindingSecret: string }> {
  const config = deps.config === undefined ? readShopifyAppConfig() : deps.config;
  if (!config) throw new ShopifyConnectError("Shopify is not configured", "not_configured");
  const shopDomain = normalizeShopifyShopDomain(shopInput);
  if (!shopDomain) throw new ShopifyConnectError("Invalid shop domain", "invalid_shop");
  const nonce = createShopifyOAuthNonce();
  const browserBindingSecret = createShopifyBrowserBindingSecret();
  const now = deps.now ?? new Date();
  const state = await signShopifyOAuthState({ memberId, shopDomain, nonce });
  await createShopifyOAuthState(prisma, {
    nonce,
    memberId,
    shopDomain,
    browserBindingHash: hashShopifyBrowserBinding(browserBindingSecret),
    expiresAt: new Date(now.getTime() + SHOPIFY_OAUTH_STATE_TTL_MS),
  });
  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
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

export async function completeShopifyOAuth(
  searchParams: URLSearchParams,
  deps: ShopifyConnectDeps & { browserBindingSecret?: string | null } = {}
): Promise<ShopifyPublicConnection> {
  const config = deps.config === undefined ? readShopifyAppConfig() : deps.config;
  if (!config) throw new ShopifyConnectError("Shopify is not configured", "not_configured");
  const params = callbackParams(searchParams);
  const code = params?.code ?? "";
  const state = params?.state ?? "";
  const shopDomain = params?.shop ? normalizeShopifyShopDomain(params.shop) : null;
  if (!params || !code || !state || !shopDomain || !params.hmac || !params.timestamp) {
    throw new ShopifyConnectError("Invalid Shopify callback", "invalid_callback");
  }
  if (!verifyShopifyOAuthHmac(params, config.clientSecret)) {
    throw new ShopifyConnectError("Invalid Shopify callback", "invalid_callback");
  }
  const verified = await verifyShopifyOAuthState(state);
  if (!verified) {
    throw new ShopifyConnectError(
      "Invalid Shopify OAuth state",
      "invalid_state",
      "SIGNED_STATE_INVALID"
    );
  }
  // requestedShopDomain (signed) is an onboarding routing hint only.
  // Authoritative identity is callback shop + Admin API Shop.id / myshopifyDomain.
  const requestedShopDomain = verified.shopDomain;
  if (requestedShopDomain !== shopDomain) {
    console.info("SHOPIFY_OAUTH_REQUESTED_CALLBACK_SHOP_DIVERGED", {
      requestedShop: requestedShopDomain,
      callbackShop: shopDomain,
      rawCallbackShop: params.shop,
      attemptId: verified.nonce.slice(0, 8),
    });
  }
  // Keep empty/whitespace handling identical to production (no trim).
  const browserBindingSecret = deps.browserBindingSecret ?? "";
  if (!browserBindingSecret) {
    throw new ShopifyConnectError(
      "Invalid Shopify OAuth state",
      "invalid_state",
      "BROWSER_BINDING_COOKIE_MISSING"
    );
  }
  const storedBindingHash = await readShopifyOAuthBrowserBindingHash(prisma, {
    nonce: verified.nonce,
    memberId: verified.memberId,
    shopDomain: verified.shopDomain,
    now: deps.now,
  });
  if (!storedBindingHash) {
    // Unexpired/unconsumed row missing for this nonce — treat as unusable state.
    throw new ShopifyConnectError(
      "Invalid Shopify OAuth state",
      "invalid_state",
      "BROWSER_BINDING_STATE_UNUSABLE"
    );
  }
  if (!shopifyBrowserBindingMatches(storedBindingHash, browserBindingSecret)) {
    throw new ShopifyConnectError(
      "Invalid Shopify OAuth state",
      "invalid_state",
      "BROWSER_BINDING_HASH_MISMATCH"
    );
  }

  // One-time consume AFTER callback crypto/browser validation, BEFORE token exchange.
  // Compares against requested shop from signed state — never against callback shop.
  const consumed = await consumeShopifyOAuthState(prisma, {
    nonce: verified.nonce,
    memberId: verified.memberId,
    shopDomain: verified.shopDomain,
    now: deps.now,
  });
  if (consumed !== "ok") {
    throw new ShopifyConnectError(
      "Invalid Shopify OAuth state",
      "invalid_state",
      "STATE_CONSUME_REJECTED"
    );
  }

  let tokens;
  try {
    // Token exchange MUST use the Shopify callback shop (permanent OAuth domain).
    tokens = await exchangeShopifyAuthorizationCode({
      shopDomain,
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
  } catch {
    throw new ShopifyConnectError("Shopify token exchange failed", "token_exchange");
  }
  if (missingShopifyScopes(tokens.scope, config.scopes).length > 0) {
    throw new ShopifyConnectError("Shopify did not grant the required scopes", "scopes");
  }

  let identity;
  let locations;
  try {
    identity = await fetchShopifyShopIdentity({
      shopDomain,
      accessToken: tokens.accessToken,
      requestedShopDomain,
      fetchImpl: deps.fetchImpl,
    });
    locations = await fetchShopifyLocations({
      shopDomain: identity.shopDomain,
      accessToken: tokens.accessToken,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    if (error instanceof ShopifyDomainAssociationError) {
      console.info("SHOPIFY_OAUTH_STATE_REJECTED", {
        reason: error.associationReason,
        requestedShop: requestedShopDomain,
        callbackShop: shopDomain,
        attemptId: verified.nonce.slice(0, 8),
      });
      throw new ShopifyConnectError(
        "Shopify shop identity could not be verified",
        "shop_identity",
        error.associationReason
      );
    }
    throw new ShopifyConnectError("Shopify shop identity could not be verified", "shop_identity");
  }
  if (identity.shopDomain !== shopDomain) {
    throw new ShopifyConnectError("Shopify shop identity did not match", "shop_mismatch");
  }
  console.info("SHOPIFY_OAUTH_REQUESTED_DOMAIN_ASSOCIATION", {
    requestedShop: requestedShopDomain,
    canonicalShop: identity.shopDomain,
    shopId: identity.shopId,
    associated: true,
    attemptId: verified.nonce.slice(0, 8),
  });

  try {
    await registerShopifyUninstallWebhook({
      shopDomain: identity.shopDomain,
      accessToken: tokens.accessToken,
      callbackUrl: config.uninstallWebhookUri,
      fetchImpl: deps.fetchImpl,
    });
    await ensureShopifyProductsUpdateWebhook({
      shopDomain: identity.shopDomain,
      accessToken: tokens.accessToken,
      callbackUrl: config.providerEvidenceWebhookUri,
      fetchImpl: deps.fetchImpl,
    });
    await ensureShopifyOrdersPaidWebhook({
      shopDomain: identity.shopDomain,
      accessToken: tokens.accessToken,
      callbackUrl: config.providerEvidenceWebhookUri,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    // Safe classification only — never log tokens/secrets/full payloads.
    const reason =
      error instanceof Error
        ? error.message.slice(0, 180)
        : "webhook_registration_failed";
    console.info("SHOPIFY_OAUTH_WEBHOOK_FAILED", {
      attemptId: verified.nonce.slice(0, 8),
      canonicalShop: identity.shopDomain,
      reason,
    });
    throw new ShopifyConnectError(
      "Shopify webhook subscriptions could not be registered",
      "webhook"
    );
  }
  const candidates = selectInventoryLocations(locations);
  const primaryLocationId = candidates.length === 1 ? candidates[0].id : null;
  try {
    return await persistShopifyInstall(prisma, {
      memberId: verified.memberId,
      shopDomain: identity.shopDomain,
      shopId: identity.shopId,
      accessTokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: encrypt(tokens.refreshToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      grantedScopes: tokens.scope,
      primaryLocationId,
      connectedAt: deps.now,
    });
  } catch (error) {
    if (error instanceof ShopifyShopOwnershipConflictError) {
      throw new ShopifyConnectError(
        "Shopify store is already connected to another INW account.",
        "shop_owned"
      );
    }
    throw error;
  }
}

const REFRESH_SKEW_MS = 60_000;

export async function accessTokenForConnection(
  connection: {
    id: string;
    memberId: string;
    shopDomain: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
    grantedScopes: string;
  },
  deps: ShopifyConnectDeps = {}
): Promise<string> {
  const config = deps.config === undefined ? readShopifyAppConfig() : deps.config;
  if (!config) throw new ShopifyConnectError("Shopify is not configured", "not_configured");
  const now = deps.now ?? new Date();
  if (connection.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > now.getTime()) {
    return decrypt(connection.accessTokenEncrypted);
  }
  if (connection.refreshTokenExpiresAt.getTime() <= now.getTime()) {
    throw new ShopifyConnectError("Shopify reauthorization is required", "token_exchange");
  }
  const refreshToken = decrypt(connection.refreshTokenEncrypted);
  const refreshed = await refreshShopifyOfflineToken({
    shopDomain: connection.shopDomain,
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fetchImpl: deps.fetchImpl,
    now,
  });
  if (refreshed.status !== "refreshed") {
    throw new ShopifyConnectError("Shopify reauthorization is required", "token_exchange");
  }
  const accessTokenEncrypted = encrypt(refreshed.tokens.accessToken);
  const refreshTokenEncrypted = encrypt(refreshed.tokens.refreshToken);
  const rotated = await rotateShopifyTokenMaterial(prisma, {
    memberId: connection.memberId,
    connectionId: connection.id,
    expectedRefreshTokenEncrypted: connection.refreshTokenEncrypted,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    accessTokenExpiresAt: refreshed.tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: refreshed.tokens.refreshTokenExpiresAt,
    grantedScopes: refreshed.tokens.scope || undefined,
  });
  if (!rotated) {
    const current = await prisma.shopifyConnection.findFirst({
      where: { id: connection.id, memberId: connection.memberId, status: "ACTIVE" },
    });
    if (!current) throw new ShopifyConnectError("Shopify reauthorization is required", "token_exchange");
    return decrypt(current.accessTokenEncrypted);
  }
  return refreshed.tokens.accessToken;
}

export function toPublicShopifyConnection(connection: ShopifyPublicConnection) {
  return {
    id: connection.id,
    shopDomain: connection.shopDomain,
    shopId: connection.shopId,
    generation: connection.generation,
    status: connection.status,
    grantedScopes: connection.grantedScopes.split(",").map((scope) => scope.trim()).filter(Boolean),
    primaryLocationId: connection.primaryLocationId,
    inventoryReady: connection.status === "ACTIVE" && Boolean(connection.primaryLocationId),
    locationSelectionRequired: connection.status === "ACTIVE" && !connection.primaryLocationId,
    connectedAt: connection.connectedAt.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
  };
}
