import { NextRequest, NextResponse } from "next/server";
import {
  clearedShopifyBrowserBindingCookie,
  SHOPIFY_OAUTH_BROWSER_COOKIE,
} from "@/lib/shopify/browser-binding";
import { completeShopifyOAuth, ShopifyConnectError } from "@/lib/shopify/connect";
import { readShopifyAppConfig } from "@/lib/shopify/config";
import { SHOPIFY_SELLER_RETURN_PATH } from "@/lib/shopify/constants";

export const dynamic = "force-dynamic";

function redirectToSeller(appUrl: string, errorCode?: string) {
  const path = errorCode
    ? `${SHOPIFY_SELLER_RETURN_PATH}?shopify_error=${encodeURIComponent(errorCode)}`
    : `${SHOPIFY_SELLER_RETURN_PATH}?shopify=connected`;
  const response = NextResponse.redirect(new URL(path, appUrl));
  const cookie = clearedShopifyBrowserBindingCookie();
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export async function GET(req: NextRequest) {
  const config = readShopifyAppConfig();
  if (!config) {
    const response = NextResponse.json({ error: "Shopify is not configured" }, { status: 503 });
    const cookie = clearedShopifyBrowserBindingCookie();
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }
  try {
    const bindingCookiePresent = Boolean(req.cookies.get(SHOPIFY_OAUTH_BROWSER_COOKIE)?.value);
    console.info("SHOPIFY_OAUTH_CALLBACK_BINDING_PRESENT", {
      host: req.nextUrl.host,
      path: req.nextUrl.pathname,
      bindingCookiePresent,
    });
    await completeShopifyOAuth(req.nextUrl.searchParams, {
      browserBindingSecret: req.cookies.get(SHOPIFY_OAUTH_BROWSER_COOKIE)?.value ?? null,
    });
    return redirectToSeller(config.appUrl);
  } catch (error) {
    const code = error instanceof ShopifyConnectError ? error.code : "invalid_callback";
    if (error instanceof ShopifyConnectError && error.code === "invalid_state" && error.reason) {
      // Non-secret diagnostic only — never log state/code/cookie/token values.
      // myshopify.com hostnames are safe to log for SIGNED_STATE_SHOP_MISMATCH.
      console.info("SHOPIFY_OAUTH_STATE_REJECTED", {
        reason: error.reason,
        host: req.nextUrl.host,
        path: req.nextUrl.pathname,
        bindingCookiePresent: Boolean(req.cookies.get(SHOPIFY_OAUTH_BROWSER_COOKIE)?.value),
        signedStateShop: error.diagnostic?.signedStateShop,
        callbackShop: error.diagnostic?.callbackShop,
        rawCallbackShop: error.diagnostic?.rawCallbackShop,
        attemptId: error.diagnostic?.attemptId,
      });
    }
    return redirectToSeller(config.appUrl, code);
  }
}
