import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";

export const dynamic = "force-dynamic";

const SHIPPO_OAUTH_AUTHORIZE = "https://goshippo.com/oauth/authorize";
const COOKIE_NAME = "shippo_oauth";
const COOKIE_MAX_AGE = 600; // 10 min

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * GET: Start Shippo OAuth. Requires authenticated seller.
 * Sets a cookie with state and userId, then redirects to Shippo.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.redirect(new URL("/login?callbackUrl=/seller-hub/shipping-setup", getBaseUrl(req)));
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.redirect(new URL("/seller-hub/shipping-setup", getBaseUrl(req)));
  }

  const clientId = process.env.SHIPPO_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/seller-hub/shipping-setup?oauth_error=Connect+with+Shippo+is+not+configured+yet.+Use+API+key+for+now.", getBaseUrl(req))
    );
  }

  const state = crypto.randomUUID();
  const payload = JSON.stringify({ state, userId });
  const cookieValue = Buffer.from(payload, "utf8").toString("base64url");
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/shipping/oauth-callback`;

  const authUrl = new URL(SHIPPO_OAUTH_AUTHORIZE);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", "*");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("redirect_uri", redirectUri);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
