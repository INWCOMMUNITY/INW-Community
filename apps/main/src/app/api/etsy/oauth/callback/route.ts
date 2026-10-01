import { NextRequest, NextResponse } from "next/server";
import {
  clearedEtsyBrowserBindingCookie,
  ETSY_OAUTH_BROWSER_COOKIE,
} from "@/lib/etsy/browser-binding";
import { completeEtsyOAuth, EtsyConnectError } from "@/lib/etsy/connect";
import { readEtsyAppConfig } from "@/lib/etsy/config";
import { ETSY_SELLER_RETURN_PATH } from "@/lib/etsy/constants";

export const dynamic = "force-dynamic";

function redirectToSeller(appUrl: string, errorCode?: string) {
  const path = errorCode
    ? `${ETSY_SELLER_RETURN_PATH}?etsy_error=${encodeURIComponent(errorCode)}`
    : `${ETSY_SELLER_RETURN_PATH}?etsy=connected`;
  const response = NextResponse.redirect(new URL(path, appUrl));
  const cookie = clearedEtsyBrowserBindingCookie();
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export async function GET(req: NextRequest) {
  const config = readEtsyAppConfig();
  if (!config) {
    const response = NextResponse.json({ error: "Etsy is not configured" }, { status: 503 });
    const cookie = clearedEtsyBrowserBindingCookie();
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }
  try {
    const bindingCookiePresent = Boolean(req.cookies.get(ETSY_OAUTH_BROWSER_COOKIE)?.value);
    console.info("ETSY_OAUTH_CALLBACK_BINDING_PRESENT", {
      host: req.nextUrl.host,
      path: req.nextUrl.pathname,
      bindingCookiePresent,
    });
    await completeEtsyOAuth(req.nextUrl.searchParams, {
      browserBindingSecret: req.cookies.get(ETSY_OAUTH_BROWSER_COOKIE)?.value ?? null,
    });
    return redirectToSeller(config.appUrl);
  } catch (error) {
    const code = error instanceof EtsyConnectError ? error.code : "invalid_callback";
    if (error instanceof EtsyConnectError && error.code === "invalid_state" && error.reason) {
      console.info("ETSY_OAUTH_STATE_REJECTED", {
        reason: error.reason,
        host: req.nextUrl.host,
        path: req.nextUrl.pathname,
        bindingCookiePresent: Boolean(req.cookies.get(ETSY_OAUTH_BROWSER_COOKIE)?.value),
      });
    }
    return redirectToSeller(config.appUrl, code);
  }
}
