/** eBay Sell API endpoints, scopes, and app credentials (production only). */

// REST base for the Sell APIs (inventory, account, fulfillment) and Trading API.
export const EBAY_API_BASE = "https://api.ebay.com";
// Identity / commerce APIs live on the apiz host.
export const EBAY_APIZ_BASE = "https://apiz.ebay.com";
export const EBAY_AUTH_URL = "https://auth.ebay.com/oauth2/authorize";
export const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
/** Opens eBay's sign-out page in the device browser (clears the shared OAuth cookie session). */
export const EBAY_SIGN_OUT_URL = "https://signin.ebay.com/logout/confirm";

/** US marketplace. eBay REST headers must use simple locale tags (en-US), not browser q-values. */
export const EBAY_MARKETPLACE_ID = "EBAY_US";
export const EBAY_ACCEPT_LANGUAGE = "en-US";
export const EBAY_CONTENT_LANGUAGE = "en-US";
export const EBAY_CURRENCY = "USD";
/** Trading API site id for the US (used by the legacy enumeration call). */
export const EBAY_TRADING_SITE_ID = "0";
export const EBAY_TRADING_COMPAT_LEVEL = "1193";

/**
 * Scopes (full URLs, space-joined for the authorize request):
 * - sell.inventory: create/update/publish offers + inventory items
 * - sell.account: read business policies (payment/return/fulfillment)
 * - sell.fulfillment: read orders for sale detection (pooled inventory)
 * - commerce.identity.readonly: resolve the seller's username
 */
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export type EbayAppConfig = {
  clientId: string;
  clientSecret: string;
  /** eBay RuName (the configured redirect identifier; used as redirect_uri in OAuth). */
  ruName: string;
  defaultCategoryId: string | null;
};

/** Reads eBay app credentials from the environment. Throws if core OAuth values are missing. */
export function getEbayConfig(): EbayAppConfig {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() || "";
  const ruName = process.env.EBAY_RUNAME?.trim() || "";
  if (!clientId || !clientSecret || !ruName) {
    throw new Error(
      "eBay is not configured: set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RUNAME."
    );
  }
  return {
    clientId,
    clientSecret,
    ruName,
    defaultCategoryId: process.env.EBAY_DEFAULT_CATEGORY_ID?.trim() || null,
  };
}

export function isEbayConfigured(): boolean {
  try {
    getEbayConfig();
    return true;
  } catch {
    return false;
  }
}
