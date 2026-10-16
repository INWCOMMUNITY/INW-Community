import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { signShippoOAuthState } from "@/lib/shippo-oauth-state";
import { setSellerOnboardingReturnCookie } from "@/lib/seller-onboarding-return";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

const SHIPPO_OAUTH_AUTHORIZE = "https://goshippo.com/oauth/authorize";

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * GET: Start Shippo OAuth (web). Requires authenticated seller.
 * Redirects to Shippo with signed JWT `state` (no cookie).
 */
export async function GET(req: NextRequest) {
  const returnOnboarding = req.nextUrl.searchParams.get("return") === "onboarding";
  const setupPath = returnOnboarding ? "/signup/seller?step=shipping" : "/seller-hub/shipping-setup";
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(setupPath)}`, getBaseUrl(req)));
  }

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.redirect(new URL(setupPath, getBaseUrl(req)));
  }

  const clientId = process.env.SHIPPO_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(
      new URL(
        setupPath +
          (setupPath.includes("?") ? "&" : "?") +
          "oauth_error=" +
          encodeURIComponent("Connect with Shippo is not configured yet. Contact support."),
        getBaseUrl(req)
      )
    );
  }

  let stateJwt: string;
  try {
    stateJwt = await signShippoOAuthState(userId, false);
  } catch {
    return NextResponse.redirect(
      new URL(
        setupPath +
          (setupPath.includes("?") ? "&" : "?") +
          "oauth_error=" +
          encodeURIComponent("Could not start OAuth. Try again."),
        getBaseUrl(req)
      )
    );
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/shipping/oauth-callback`;

  const authUrl = new URL(SHIPPO_OAUTH_AUTHORIZE);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", "*");
  authUrl.searchParams.set("state", stateJwt);
  authUrl.searchParams.set(
    "utm_source",
    process.env.SHIPPO_OAUTH_UTM_SOURCE?.trim() || "northwestcommunity"
  );
  authUrl.searchParams.set("redirect_uri", redirectUri);

  const response = NextResponse.redirect(authUrl.toString());
  if (returnOnboarding) setSellerOnboardingReturnCookie(response, "shipping");
  return response;
}
