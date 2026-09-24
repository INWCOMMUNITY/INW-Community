import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { shopifyBrowserBindingCookie } from "@/lib/shopify/browser-binding";
import { beginShopifyConnect, ShopifyConnectError } from "@/lib/shopify/connect";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  let shop = "";
  try {
    const body = (await req.json()) as { shop?: unknown };
    shop = typeof body.shop === "string" ? body.shop : "";
  } catch {
    return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
  }
  try {
    const { authorizeUrl, browserBindingSecret } = await beginShopifyConnect(memberId, shop);
    const response = NextResponse.json({ authorizeUrl });
    const cookie = shopifyBrowserBindingCookie(browserBindingSecret);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    if (error instanceof ShopifyConnectError && error.code === "invalid_shop") {
      return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
    }
    if (error instanceof ShopifyConnectError && error.code === "not_configured") {
      return NextResponse.json({ error: "Shopify is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not start Shopify connection" }, { status: 500 });
  }
}
