import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { signShippoOAuthState } from "@/lib/shippo-oauth-state";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

const SHIPPO_OAUTH_AUTHORIZE = "https://goshippo.com/oauth/authorize";

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * POST: Returns Shippo authorize URL for mobile (Bearer session). Same checks as GET oauth-start.
 * Body ignored. Response: { url: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json(
      { error: "Subscribe or Seller plan required to connect shipping." },
      { status: 403 }
    );
  }

  const clientId = process.env.SHIPPO_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: "Shippo OAuth is not configured on the server.", code: "OAUTH_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  let stateJwt: string;
  try {
    stateJwt = await signShippoOAuthState(userId, true);
  } catch {
    return NextResponse.json({ error: "Could not start OAuth." }, { status: 500 });
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

  return NextResponse.json({ url: authUrl.toString() });
}
