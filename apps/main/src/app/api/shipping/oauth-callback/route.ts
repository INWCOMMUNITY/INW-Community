import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { encrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";

const SHIPPO_OAUTH_ACCESS_TOKEN = "https://goshippo.com/oauth/access_token";
const COOKIE_NAME = "shippo_oauth";

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * GET: Shippo OAuth callback. Exchanges code for access token and stores it for the user.
 * Redirect URI must be registered with Shippo (e.g. https://yoursite.com/api/shipping/oauth-callback).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const baseUrl = getBaseUrl(req);
  const shippingSetupUrl = `${baseUrl}/seller-hub/shipping-setup`;

  if (error) {
    const desc = searchParams.get("error_description");
    return NextResponse.redirect(
      `${shippingSetupUrl}?oauth_error=${encodeURIComponent(desc ?? error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${shippingSetupUrl}?oauth_error=missing_code_or_state`);
  }

  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(`${shippingSetupUrl}?oauth_error=session_expired`);
  }

  let statePayload: { state: string; userId: string };
  try {
    statePayload = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8"));
  } catch {
    return NextResponse.redirect(`${shippingSetupUrl}?oauth_error=invalid_session`);
  }

  if (statePayload.state !== state) {
    return NextResponse.redirect(`${shippingSetupUrl}?oauth_error=invalid_state`);
  }

  const clientId = process.env.SHIPPO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.SHIPPO_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${shippingSetupUrl}?oauth_error=server_not_configured`);
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
        ? (tokenData as { error_description?: string }).error_description
        : "Token exchange failed";
    return NextResponse.redirect(
      `${shippingSetupUrl}?oauth_error=${encodeURIComponent(String(msg))}`
    );
  }

  const accessToken = (tokenData as { access_token?: string }).access_token;
  if (!accessToken) {
    return NextResponse.redirect(`${shippingSetupUrl}?oauth_error=no_token_returned`);
  }

  let encryptedToken: string;
  try {
    encryptedToken = encrypt(accessToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Encryption failed";
    return NextResponse.redirect(
      `${shippingSetupUrl}?oauth_error=${encodeURIComponent(msg)}`
    );
  }

  await prisma.member.update({
    where: { id: statePayload.userId },
    data: { shippoOAuthTokenEncrypted: encryptedToken },
  });

  const res = NextResponse.redirect(`${shippingSetupUrl}?connected=shippo`);
  res.cookies.delete(COOKIE_NAME);
  return res;
}
