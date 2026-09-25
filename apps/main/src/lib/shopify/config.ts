import { SHOPIFY_ADMIN_API_VERSION, SHOPIFY_OAUTH_SCOPES } from "./constants";

export type ShopifyAppConfig = {
  clientId: string;
  clientSecret: string;
  appUrl: string;
  redirectUri: string;
  uninstallWebhookUri: string;
  /** S3 generic provider-evidence inbox (S6 PRODUCTS_UPDATE delivery). */
  providerEvidenceWebhookUri: string;
  scopes: readonly string[];
  apiVersion: string;
};

export function readShopifyAppConfig(
  env: NodeJS.ProcessEnv = process.env
): ShopifyAppConfig | null {
  const clientId = env.SHOPIFY_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim() ?? "";
  const appUrl = (env.SHOPIFY_APP_URL?.trim() ?? "").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !appUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  return {
    clientId,
    clientSecret,
    appUrl,
    redirectUri: `${appUrl}/api/shopify/oauth/callback`,
    uninstallWebhookUri: `${appUrl}/api/shopify/webhooks/uninstalled`,
    providerEvidenceWebhookUri: `${appUrl}/api/shopify/webhooks/inbox`,
    scopes: SHOPIFY_OAUTH_SCOPES,
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
  };
}
