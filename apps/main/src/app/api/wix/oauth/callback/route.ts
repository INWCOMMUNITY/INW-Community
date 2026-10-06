import { NextRequest, NextResponse } from "next/server";
import { getWixBrowserBindingCookieName } from "@/lib/wix/browser-binding";
import { completeWixOAuth, WixConnectError } from "@/lib/wix/connect";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  
  // Get browser binding cookie
  const browserBindingSecret = req.cookies.get(getWixBrowserBindingCookieName())?.value;
  
  try {
    const connection = await completeWixOAuth(searchParams, {
      browserBindingSecret,
    });

    console.info("WIX_OAUTH_CALLBACK_SUCCESS", {
      connectionId: connection.id,
      siteId: connection.siteId,
      catalogVersion: connection.catalogVersion,
    });

    // Redirect to the Sync Stores page in the app
    const successUrl = new URL("/seller-hub/sync-stores", req.nextUrl.origin);
    successUrl.searchParams.set("wix_connected", "true");
    successUrl.searchParams.set("connection_id", connection.id);
    
    const response = NextResponse.redirect(successUrl);
    // Clear the browser binding cookie
    response.cookies.delete(getWixBrowserBindingCookieName());
    return response;
  } catch (error) {
    console.error("WIX_OAUTH_CALLBACK_ERROR", {
      error: error instanceof Error ? error.message : "Unknown error",
      code: error instanceof WixConnectError ? error.code : undefined,
      reason: error instanceof WixConnectError ? error.reason : undefined,
    });

    const errorUrl = new URL("/seller-hub/sync-stores", req.nextUrl.origin);
    
    if (error instanceof WixConnectError) {
      errorUrl.searchParams.set("wix_error", error.code);
      if (error.code === "not_configured") {
        errorUrl.searchParams.set("wix_error_message", "Wix integration is not configured");
      } else if (error.code === "invalid_state") {
        errorUrl.searchParams.set("wix_error_message", "Connection expired. Please try again.");
      } else if (error.code === "site_owned") {
        errorUrl.searchParams.set("wix_error_message", "This Wix site is already connected to another account");
      } else if (error.code === "token_exchange") {
        errorUrl.searchParams.set("wix_error_message", "Could not complete Wix authorization");
      } else if (error.code === "catalog_version") {
        errorUrl.searchParams.set("wix_error_message", error.message);
      } else {
        errorUrl.searchParams.set("wix_error_message", "Could not connect to Wix");
      }
    } else {
      errorUrl.searchParams.set("wix_error", "unknown");
      errorUrl.searchParams.set("wix_error_message", "An unexpected error occurred");
    }

    const response = NextResponse.redirect(errorUrl);
    response.cookies.delete(getWixBrowserBindingCookieName());
    return response;
  }
}
