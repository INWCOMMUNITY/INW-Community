import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { encrypt } from "@/lib/encrypt";
import { verifyShippoOAuthState } from "@/lib/shippo-oauth-state";
import {
  clearSellerOnboardingReturnCookie,
  readSellerOnboardingReturn,
  sellerOnboardingReturnPath,
} from "@/lib/seller-onboarding-return";

export const dynamic = "force-dynamic";

const SHIPPO_OAUTH_ACCESS_TOKEN = "https://goshippo.com/oauth/access_token";

const APP_DEEP_LINK_BASE = "inwcommunity://seller-hub/shipping-setup";

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function redirectAfterOAuth(
  app: boolean,
  baseUrl: string,
  query: Record<string, string>,
  onboarding: boolean
): NextResponse {
  const qs = new URLSearchParams(query).toString();
  if (app) {
    const target = qs ? `${APP_DEEP_LINK_BASE}?${qs}` : APP_DEEP_LINK_BASE;
    return NextResponse.redirect(target);
  }
  const path = onboarding
    ? sellerOnboardingReturnPath("shipping", query)
    : `/seller-hub/shipping-setup${qs ? `?${qs}` : ""}`;
  const response = NextResponse.redirect(`${baseUrl}${path}`);
  if (onboarding) clearSellerOnboardingReturnCookie(response);
  return response;
}

/**
 * GET: Shippo OAuth callback. Exchanges code for access token and stores it for the user.
 * Redirect URI must be registered with Shippo (e.g. https://yoursite.com/api/shipping/oauth-callback).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");
  const baseUrl = getBaseUrl(req);

  const statePayload = stateParam ? await verifyShippoOAuthState(stateParam) : null;
  const returnApp = statePayload?.app ?? false;
  const returnOnboarding = !returnApp && readSellerOnboardingReturn(req) === "shipping";

  if (error) {
    const desc = searchParams.get("error_description");
    const msg = desc ? decodeURIComponent(desc.replace(/\+/g, " ")) : error;
    return redirectAfterOAuth(returnApp, baseUrl, { oauth_error: msg }, returnOnboarding);
  }

  if (!code || !stateParam) {
    return redirectAfterOAuth(returnApp, baseUrl, { oauth_error: "missing_code_or_state" }, returnOnboarding);
  }

  if (!statePayload) {
    return redirectAfterOAuth(false, baseUrl, { oauth_error: "invalid_or_expired_state" }, returnOnboarding);
  }

  const clientId = process.env.SHIPPO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.SHIPPO_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirectAfterOAuth(returnApp, baseUrl, { oauth_error: "server_not_configured" }, returnOnboarding);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(SHIPPO_OAUTH_ACCESS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const tokenData = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string; token_type?: string }
    | { error?: string; error_description?: string }
    | null;

  if (!tokenRes.ok || !tokenData || "error" in tokenData) {
    const msg =
      tokenData && "error_description" in tokenData
        ? String((tokenData as { error_description?: string }).error_description)
        : "Token exchange failed";
    return redirectAfterOAuth(returnApp, baseUrl, { oauth_error: msg }, returnOnboarding);
  }

  const accessToken = (tokenData as { access_token?: string }).access_token;
  if (!accessToken) {
    return redirectAfterOAuth(returnApp, baseUrl, { oauth_error: "no_token_returned" }, returnOnboarding);
  }

  let encryptedToken: string;
  try {
    encryptedToken = encrypt(accessToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Encryption failed";
    return redirectAfterOAuth(returnApp, baseUrl, { oauth_error: msg }, returnOnboarding);
  }

  await prisma.member.update({
    where: { id: statePayload.sub },
    data: { shippoOAuthTokenEncrypted: encryptedToken },
  });

  return redirectAfterOAuth(returnApp, baseUrl, { connected: "shippo" }, returnOnboarding);
}
