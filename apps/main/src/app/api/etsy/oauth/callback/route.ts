import { NextRequest, NextResponse } from "next/server";
import {
  clearedEtsyBrowserBindingCookie,
  ETSY_OAUTH_BROWSER_COOKIE,
} from "@/lib/etsy/browser-binding";
import { completeEtsyOAuth, EtsyConnectError } from "@/lib/etsy/connect";
import { readEtsyAppConfig } from "@/lib/etsy/config";
import { ETSY_SELLER_RETURN_PATH } from "@/lib/etsy/constants";

export const dynamic = "force-dynamic";

function sellerReturnBase(req: NextRequest, configuredAppUrl: string): string {
  // Prefer the live request origin so we never bounce sellers to a stale ETSY_APP_URL host.
  const origin = req.nextUrl.origin?.replace(/\/+$/, "");
  if (origin && (origin.startsWith("https://") || origin.startsWith("http://"))) {
    return origin;
  }
  return configuredAppUrl;
}

function redirectToSeller(baseUrl: string, errorCode?: string) {
  const path = errorCode
    ? `${ETSY_SELLER_RETURN_PATH}?etsy_error=${encodeURIComponent(errorCode)}`
    : `${ETSY_SELLER_RETURN_PATH}?etsy=connected`;
  const response = NextResponse.redirect(new URL(path, baseUrl));
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
  const returnBase = sellerReturnBase(req, config.appUrl);
  try {
    const bindingCookiePresent = Boolean(req.cookies.get(ETSY_OAUTH_BROWSER_COOKIE)?.value);
    console.info("ETSY_OAUTH_CALLBACK_BINDING_PRESENT", {
      host: req.nextUrl.host,
      path: req.nextUrl.pathname,
      bindingCookiePresent,
      returnBase,
    });
    await completeEtsyOAuth(req.nextUrl.searchParams, {
      browserBindingSecret: req.cookies.get(ETSY_OAUTH_BROWSER_COOKIE)?.value ?? null,
    });
    console.info("ETSY_OAUTH_CALLBACK_OK", { returnBase });
    return redirectToSeller(returnBase);
  } catch (error) {
    const code = error instanceof EtsyConnectError ? error.code : "invalid_callback";
    const reason =
      error instanceof EtsyConnectError && error.code === "invalid_state" ? error.reason : undefined;
    console.info("ETSY_OAUTH_CALLBACK_FAILED", {
      code,
      reason,
      host: req.nextUrl.host,
      path: req.nextUrl.pathname,
      bindingCookiePresent: Boolean(req.cookies.get(ETSY_OAUTH_BROWSER_COOKIE)?.value),
      message: error instanceof Error ? error.message : "unknown",
    });
    return redirectToSeller(returnBase, code);
  }
}
