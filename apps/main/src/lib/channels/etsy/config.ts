/** Etsy Open API v3 endpoints, scopes, and app credentials. */

export const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
export const ETSY_CONNECT_URL = "https://www.etsy.com/oauth/connect";

/**
 * Scopes:
 * - listings_r / listings_w: read + create/update/delete listings and inventory
 * - transactions_r: read receipts/transactions for sale detection (pooled inventory)
 * - shops_r: resolve the seller's shop id
 */
export const ETSY_SCOPES = ["listings_r", "listings_w", "transactions_r", "shops_r"];

export type EtsyAppConfig = {
  clientId: string;
  apiKey: string;
  clientSecret: string;
  redirectUri: string;
  webhookSecret: string | null;
};

/** Reads Etsy app credentials from the environment. Throws if the core OAuth values are missing. */
export function getEtsyConfig(): EtsyAppConfig {
  // ETSY_API_KEY (keystring) doubles as the OAuth client_id for Etsy v3.
  const apiKey = process.env.ETSY_API_KEY?.trim() || process.env.ETSY_CLIENT_ID?.trim() || "";
  const clientId = process.env.ETSY_CLIENT_ID?.trim() || apiKey;
  const clientSecret = process.env.ETSY_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.ETSY_REDIRECT_URI?.trim() || "";
  if (!apiKey || !clientId) {
    throw new Error("Etsy is not configured: set ETSY_API_KEY (keystring) / ETSY_CLIENT_ID.");
  }
  return {
    clientId,
    apiKey,
    clientSecret,
    redirectUri,
    webhookSecret: process.env.ETSY_WEBHOOK_SECRET?.trim() || null,
  };
}

export function isEtsyConfigured(): boolean {
  try {
    getEtsyConfig();
    return true;
  } catch {
    return false;
  }
}
