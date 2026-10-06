import { NextRequest, NextResponse } from "next/server";
import { wixBrowserBindingCookie } from "@/lib/wix/browser-binding";
import { beginWixConnect, WixConnectError } from "@/lib/wix/connect";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  try {
    const { authorizeUrl, browserBindingSecret } = await beginWixConnect(memberId);
    const response = NextResponse.json({ authorizeUrl });
    const cookie = wixBrowserBindingCookie(browserBindingSecret);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    console.info("WIX_OAUTH_CONNECT_BINDING_ISSUED", {
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
    if (error instanceof WixConnectError && error.code === "not_configured") {
      return NextResponse.json({ error: "Wix is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not start Wix connection" }, { status: 500 });
  }
}
