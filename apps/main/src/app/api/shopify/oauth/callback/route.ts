import { NextRequest, NextResponse } from "next/server";
import { completeShopifyOAuth, ShopifyConnectError } from "@/lib/shopify/connect";
import { readShopifyAppConfig } from "@/lib/shopify/config";
import { SHOPIFY_SELLER_RETURN_PATH } from "@/lib/shopify/constants";

export const dynamic = "force-dynamic";

function redirectToSeller(appUrl: string, errorCode?: string) {
  const path = errorCode
    ? `${SHOPIFY_SELLER_RETURN_PATH}?shopify_error=${encodeURIComponent(errorCode)}`
    : `${SHOPIFY_SELLER_RETURN_PATH}?shopify=connected`;
  return NextResponse.redirect(new URL(path, appUrl));
}

export async function GET(req: NextRequest) {
  const config = readShopifyAppConfig();
  if (!config) {
    return NextResponse.json({ error: "Shopify is not configured" }, { status: 503 });
  }
  try {
    await completeShopifyOAuth(req.nextUrl.searchParams);
    return redirectToSeller(config.appUrl);
  } catch (error) {
    const code = error instanceof ShopifyConnectError ? error.code : "invalid_callback";
    return redirectToSeller(config.appUrl, code);
  }
}
