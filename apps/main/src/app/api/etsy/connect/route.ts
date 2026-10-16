import { NextRequest, NextResponse } from "next/server";
import { etsyBrowserBindingCookie } from "@/lib/etsy/browser-binding";
import { beginEtsyConnect, EtsyConnectError } from "@/lib/etsy/connect";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { setSellerOnboardingReturnCookie } from "@/lib/seller-onboarding-return";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  let onboarding = false;
  try {
    const body = (await req.json()) as { onboarding?: unknown };
    onboarding = body.onboarding === true;
  } catch {
    onboarding = false;
  }
  try {
    const { authorizeUrl, browserBindingSecret } = await beginEtsyConnect(memberId);
    const response = NextResponse.json({ authorizeUrl });
    const cookie = etsyBrowserBindingCookie(browserBindingSecret);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    if (onboarding) setSellerOnboardingReturnCookie(response, "import");
    console.info("ETSY_OAUTH_CONNECT_BINDING_ISSUED", {
      host: req.nextUrl.host,
      path: req.nextUrl.pathname,
      secure: Boolean(cookie.options.secure),
      sameSite: cookie.options.sameSite,
      maxAge: cookie.options.maxAge,
      cookieIssued: true,
      cookiePath: cookie.options.path,
    });
    return response;
  } catch (error) {
    if (error instanceof EtsyConnectError && error.code === "not_configured") {
      return NextResponse.json({ error: "Etsy is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not start Etsy connection" }, { status: 500 });
  }
}
