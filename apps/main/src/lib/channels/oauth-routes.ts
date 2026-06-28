import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { encrypt } from "@/lib/encrypt";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { signChannelOAuthState, verifyChannelOAuthState } from "./oauth-state";
import { getAdapter } from "./registry";
import { getOAuthProfile } from "./oauth-providers";
import { normalizeShopDomain } from "./shopify/config";
import type { ChannelProvider } from "./types";

const APP_DEEP_LINK_BASE = "inwcommunity://seller-hub/channels";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generic PKCE pair. Providers that don't use PKCE simply ignore the challenge. */
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function resolveShopifyDomain(
  provider: ChannelProvider,
  raw: string | null | undefined
): string | null {
  if (provider !== "shopify") return null;
  if (!raw?.trim()) return null;
  return normalizeShopDomain(raw);
}

async function buildAuthUrl(
  req: NextRequest,
  provider: ChannelProvider,
  userId: string,
  app: boolean,
  shopInput?: string | null,
  options?: { forceLogin?: boolean }
): Promise<string> {
  const profile = getOAuthProfile(provider);
  if (!profile) throw new Error(`No OAuth profile for provider "${provider}".`);
  const shop =
    provider === "shopify"
      ? resolveShopifyDomain(provider, shopInput ?? new URL(req.url).searchParams.get("shop"))
      : null;
  if (provider === "shopify" && !shop) {
    throw new Error("Enter your Shopify store domain (e.g. mystore or mystore.myshopify.com).");
  }
  const adapter = getAdapter(provider);
  const { verifier, challenge } = generatePkce();
  const state = await signChannelOAuthState({
    memberId: userId,
    provider,
    app,
    verifier,
    shop: shop ?? undefined,
  });
  return adapter.getAuthUrl({
    state,
    codeChallenge: challenge,
    redirectUri: profile.redirectUri(getBaseUrl(req)),
    shop: shop ?? undefined,
    prompt: provider === "ebay" && options?.forceLogin ? "login" : undefined,
  });
}

/** GET: start OAuth (web). Redirects to the provider consent screen. */
export async function channelConnectGET(
  req: NextRequest,
  provider: ChannelProvider
): Promise<NextResponse> {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  const baseUrl = getBaseUrl(req);
  if (!userId) {
    return NextResponse.redirect(new URL("/login?callbackUrl=/seller-hub/channels", baseUrl));
  }
  const profile = getOAuthProfile(provider);
  if (!profile || !profile.isConfigured()) {
    const msg = profile?.notConfiguredMessage ?? `${provider} is not configured yet.`;
    return NextResponse.redirect(
      new URL("/seller-hub/channels?channel_error=" + encodeURIComponent(msg), baseUrl)
    );
  }
  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.redirect(
      new URL("/seller-hub/channels?channel_error=seller_plan_required", baseUrl)
    );
  }
  try {
    const shopParam = new URL(req.url).searchParams.get("shop");
    const forceLogin = new URL(req.url).searchParams.get("forceLogin") === "1";
    return NextResponse.redirect(
      await buildAuthUrl(req, provider, userId, false, shopParam, { forceLogin })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : `Could not start ${provider} connect.`;
    return NextResponse.redirect(
      new URL("/seller-hub/channels?channel_error=" + encodeURIComponent(msg), baseUrl)
    );
  }
}

/** POST: returns the consent URL for the mobile app (Bearer session). Response: { url }. */
export async function channelConnectPOST(
  req: NextRequest,
  provider: ChannelProvider
): Promise<NextResponse> {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = getOAuthProfile(provider);
  if (!profile || !profile.isConfigured()) {
    return NextResponse.json(
      {
        error: profile?.notConfiguredMessage ?? `${provider} sync is not configured on the server.`,
        code: "CHANNEL_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json({ error: `Seller plan required to connect ${profile.label}.` }, { status: 403 });
  }
  try {
    let shopInput: string | undefined;
    let forceLogin = false;
    if (provider === "shopify" || provider === "ebay") {
      const body = (await req.json().catch(() => null)) as
        | { shop?: string; forceLogin?: boolean }
        | null;
      if (provider === "shopify") {
        shopInput = body?.shop;
        if (!shopInput?.trim()) {
          return NextResponse.json(
            { error: "Shopify store domain is required (e.g. mystore.myshopify.com)." },
            { status: 400 }
          );
        }
      }
      forceLogin = body?.forceLogin === true;
    }
    const url = await buildAuthUrl(req, provider, userId, true, shopInput, { forceLogin });
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : `Could not start ${provider} connect.`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Redirect back to the Sync Stores screen after a connect attempt. `app` connections return to the
 * mobile deep link; web connections return to the web page. Exported for providers with a dedicated
 * callback (e.g. Wix's install redirect).
 */
export function redirectAfterChannelConnect(
  app: boolean,
  baseUrl: string,
  query: Record<string, string>
): NextResponse {
  const qs = new URLSearchParams(query).toString();
  if (app) {
    return NextResponse.redirect(qs ? `${APP_DEEP_LINK_BASE}?${qs}` : APP_DEEP_LINK_BASE);
  }
  return NextResponse.redirect(`${baseUrl}/seller-hub/channels${qs ? `?${qs}` : ""}`);
}

const redirectAfter = redirectAfterChannelConnect;

/** GET: OAuth callback. Exchanges the code, persists encrypted tokens + initial config. */
export async function channelCallbackGET(
  req: NextRequest,
  provider: ChannelProvider
): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const baseUrl = getBaseUrl(req);

  const state = stateParam ? await verifyChannelOAuthState(stateParam) : null;
  const app = state?.app ?? false;

  if (oauthError) {
    const desc = searchParams.get("error_description");
    return redirectAfter(app, baseUrl, { channel_error: desc || oauthError });
  }
  if (!code || !stateParam) {
    return redirectAfter(app, baseUrl, { channel_error: "missing_code_or_state" });
  }
  if (!state) {
    return redirectAfter(false, baseUrl, { channel_error: "invalid_or_expired_state" });
  }
  if (state.provider !== provider) {
    return redirectAfter(app, baseUrl, { channel_error: "provider_mismatch" });
  }

  const profile = getOAuthProfile(provider);
  if (!profile) {
    return redirectAfter(app, baseUrl, { channel_error: "unsupported_provider" });
  }
  if (profile.verifyCallback && !profile.verifyCallback(req)) {
    return redirectAfter(app, baseUrl, { channel_error: "invalid_shopify_hmac" });
  }

  if (provider === "shopify") {
    const callbackShop = normalizeShopDomain(searchParams.get("shop") || "");
    if (!state.shop || !callbackShop || callbackShop !== state.shop) {
      return redirectAfter(app, baseUrl, { channel_error: "shop_mismatch" });
    }
  }

  const adapter = getAdapter(provider);
  const redirectUri = profile.redirectUri(baseUrl);

  try {
    const tokens = await adapter.exchangeCode({
      code,
      codeVerifier: state.verifier,
      redirectUri,
      shop: state.shop,
    });
    const shop = await adapter.fetchShopInfo(tokens.accessToken, { shop: state.shop });
    const initial = adapter.getInitialConfig
      ? await adapter.getInitialConfig(tokens.accessToken, shop.shopId)
      : {};

    const etsyShippingProfileId =
      typeof (initial as Record<string, unknown>).etsyShippingProfileId === "string"
        ? ((initial as Record<string, unknown>).etsyShippingProfileId as string)
        : null;

    const data = {
      provider,
      externalShopId: shop.shopId,
      externalShopName: shop.shopName,
      accessTokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresInSec
        ? new Date(Date.now() + tokens.expiresInSec * 1000)
        : null,
      scopes: tokens.scopes || profile.scopes,
      status: "active",
      lastError: null,
      etsyShippingProfileId,
      config: initial as object,
    };

    await prisma.channelConnection.upsert({
      where: { memberId_provider: { memberId: state.sub, provider } },
      create: { memberId: state.sub, ...data },
      update: data,
    });

    return redirectAfter(app, baseUrl, { connected: provider });
  } catch (e) {
    const msg = e instanceof Error ? e.message : `${profile.label} connection failed`;
    return redirectAfter(app, baseUrl, { channel_error: msg });
  }
}
