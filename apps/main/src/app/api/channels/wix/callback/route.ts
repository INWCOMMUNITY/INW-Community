import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { encrypt } from "@/lib/encrypt";
import { verifyChannelOAuthState } from "@/lib/channels/oauth-state";
import { getBaseUrl, redirectAfterChannelConnect } from "@/lib/channels/oauth-routes";
import { mintWixToken, fetchWixShopInfo } from "@/lib/channels/wix/oauth";
import { fetchWixCatalogVersion } from "@/lib/channels/wix/catalog-api";
import { fetchWixSiteId } from "@/lib/channels/wix/site";
import { reconcileConnectionFull } from "@/lib/channels/reconcile-connection";

export const dynamic = "force-dynamic";

/**
 * Wix install callback. Unlike Etsy/eBay (authorization-code), Wix's External Install Flow redirects
 * here with the site installation id (`instanceId`) and site GUID (`tenantId`) after the seller
 * installs the app. We verify our signed `state` (-> member id + app flag), mint a 4h access token,
 * and persist the connection with the instanceId stored as the "refresh token" so connection.ts can
 * re-mint transparently. No schema change: instanceId/siteId live in `config`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const baseUrl = getBaseUrl(req);

  const instanceId = searchParams.get("instanceId") || searchParams.get("instance_id");
  const tenantId =
    searchParams.get("tenantId") || searchParams.get("tenant_id") || searchParams.get("siteId");
  const stateParam = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const state = stateParam ? await verifyChannelOAuthState(stateParam) : null;
  const app = state?.app ?? false;

  if (oauthError) {
    const desc = searchParams.get("error_description");
    return redirectAfterChannelConnect(app, baseUrl, { channel_error: desc || oauthError });
  }
  if (!instanceId) {
    return redirectAfterChannelConnect(app, baseUrl, { channel_error: "missing_instance_id" });
  }
  if (!stateParam || !state) {
    return redirectAfterChannelConnect(false, baseUrl, { channel_error: "invalid_or_expired_state" });
  }
  if (state.provider !== "wix") {
    return redirectAfterChannelConnect(app, baseUrl, { channel_error: "provider_mismatch" });
  }

  try {
    const tokens = await mintWixToken(instanceId);
    const shop = await fetchWixShopInfo(tokens.accessToken);
    const siteIdFromApi = await fetchWixSiteId(tokens.accessToken);
    const siteId = tenantId || siteIdFromApi || null;
    const shopId = siteId || instanceId;
    const { api: catalogApi, raw: catalogVersion } = await fetchWixCatalogVersion(
      tokens.accessToken
    );

    const data = {
      provider: "wix",
      externalShopId: shopId,
      externalShopName: shop.shopName,
      accessTokenEncrypted: encrypt(tokens.accessToken),
      // Wix has no refresh token; the instanceId is the long-lived credential used to re-mint.
      refreshTokenEncrypted: encrypt(instanceId),
      tokenExpiresAt: tokens.expiresInSec
        ? new Date(Date.now() + tokens.expiresInSec * 1000)
        : null,
      scopes: "",
      status: "active",
      lastError: null,
      etsyShippingProfileId: null,
      config: {
        instanceId,
        siteId,
        autoImportInbound: true,
        ...(catalogApi ? { catalogApi, catalogVersion } : {}),
      } as object,
    };

    const saved = await prisma.channelConnection.upsert({
      where: { memberId_provider: { memberId: state.sub, provider: "wix" } },
      create: { memberId: state.sub, ...data },
      update: data,
    });

    // Best-effort: import catalog, mirror linked items, and catch recent Wix orders.
    reconcileConnectionFull(saved).catch((e) =>
      console.error("[channels] wix post-connect reconcile failed", { error: String(e) })
    );

    return redirectAfterChannelConnect(app, baseUrl, { connected: "wix" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Wix connection failed";
    return redirectAfterChannelConnect(app, baseUrl, { channel_error: msg });
  }
}
