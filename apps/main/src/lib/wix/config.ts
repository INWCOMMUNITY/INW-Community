export type WixAppConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  webhookPublicKey: string | null;
  defaultLocationId: string | null;
};

/**
 * Read Wix app configuration from environment variables.
 * Returns null if required variables are not set.
 */
export function readWixAppConfig(): WixAppConfig | null {
  const appId = process.env.WIX_APP_ID;
  const appSecret = process.env.WIX_APP_SECRET;

  if (!appId || !appSecret) {
    return null;
  }

  // Derive redirect URI from environment or use default
  // WIX_REDIRECT_URI takes precedence (should match Wix app dashboard)
  // NEXTAUTH_URL is the production domain with protocol (e.g. https://www.example.com)
  // VERCEL_URL is a deployment-specific subdomain without protocol
  let redirectUri = process.env.WIX_REDIRECT_URI;
  if (!redirectUri) {
    const baseUrl = process.env.NEXTAUTH_URL
      ? process.env.NEXTAUTH_URL.replace(/\/$/, "")
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
    redirectUri = `${baseUrl}/api/wix/oauth/callback`;
  }

  return {
    appId,
    appSecret,
    redirectUri,
    webhookPublicKey: process.env.WIX_WEBHOOK_PUBLIC_KEY || null,
    defaultLocationId: process.env.WIX_DEFAULT_LOCATION_ID || null,
  };
}

/**
 * Check if Wix integration is configured.
 */
export function isWixConfigured(): boolean {
  return readWixAppConfig() !== null;
}
