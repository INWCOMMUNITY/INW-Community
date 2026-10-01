import { ETSY_OAUTH_SCOPES } from "./constants";

export type EtsyAppConfig = {
  /** Etsy keystring — used as OAuth client_id and the left half of x-api-key. */
  apiKey: string;
  /** Shared secret — right half of x-api-key. Never sent as OAuth client_secret. */
  clientSecret: string;
  /** Optional override when Etsy shows a Client ID distinct from the keystring. */
  clientId: string;
  appUrl: string;
  redirectUri: string;
  /** Order webhook inbox URL derived from appUrl. */
  providerEvidenceWebhookUri: string;
  scopes: readonly string[];
};

/**
 * Reads Etsy V2 app config.
 * Prefer ETSY_APP_URL (no path) and derive the callback, matching Shopify V2.
 * ETSY_REDIRECT_URI may override when the Etsy portal was registered with an exact string.
 */
export function readEtsyAppConfig(env: NodeJS.ProcessEnv = process.env): EtsyAppConfig | null {
  const apiKey = env.ETSY_API_KEY?.trim() ?? "";
  const clientSecret = env.ETSY_CLIENT_SECRET?.trim() ?? "";
  const clientId = (env.ETSY_CLIENT_ID?.trim() || apiKey).trim();
  const appUrl = (env.ETSY_APP_URL?.trim() || env.NEXTAUTH_URL?.trim() || "").replace(/\/+$/, "");
  if (!apiKey || !clientSecret || !appUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;

  const derivedRedirect = `${appUrl}/api/etsy/oauth/callback`;
  const redirectOverride = env.ETSY_REDIRECT_URI?.trim() ?? "";
  return {
    apiKey,
    clientSecret,
    clientId,
    appUrl,
    redirectUri: redirectOverride || derivedRedirect,
    providerEvidenceWebhookUri: `${appUrl}/api/etsy/webhooks/inbox`,
    scopes: ETSY_OAUTH_SCOPES,
  };
}

/** x-api-key header value: keystring:shared_secret */
export function etsyApiKeyHeader(config: Pick<EtsyAppConfig, "apiKey" | "clientSecret">): string {
  return `${config.apiKey}:${config.clientSecret}`;
}
