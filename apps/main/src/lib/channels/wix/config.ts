/** Wix App (External Install Flow) endpoints + app credentials. */

// REST base for the Wix APIs (Stores Catalog V3, eCommerce Orders, Site Properties).
export const WIX_API_BASE = "https://www.wixapis.com";
// App installer base; the seller is sent here to install the app on their site.
export const WIX_INSTALL_BASE = "https://www.wix.com/app-installer";
// Token endpoint: mints short-lived (4h) app access tokens via client_credentials + instanceId.
export const WIX_TOKEN_URL = "https://www.wixapis.com/oauth2/token";

export type WixAppConfig = {
  appId: string;
  appSecret: string;
  /** Optional Stores location to scope inventory writes; defaults to the site's default location. */
  defaultLocationId: string | null;
};

/** Reads Wix app credentials from the environment. Throws if core values are missing. */
export function getWixConfig(): WixAppConfig {
  const appId = process.env.WIX_APP_ID?.trim() || "";
  const appSecret = process.env.WIX_APP_SECRET?.trim() || "";
  if (!appId || !appSecret) {
    throw new Error("Wix is not configured: set WIX_APP_ID and WIX_APP_SECRET.");
  }
  return {
    appId,
    appSecret,
    defaultLocationId: process.env.WIX_DEFAULT_LOCATION_ID?.trim() || null,
  };
}

export function isWixConfigured(): boolean {
  try {
    getWixConfig();
    return true;
  } catch {
    return false;
  }
}
