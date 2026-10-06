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

  // Must match the External URL / App URL saved in the Wix Developers dashboard.
  // Wix looks that field up when Connect starts; it is not a separate OAuth redirect box.
  let redirectUri = process.env.WIX_APP_URL?.trim() || process.env.WIX_REDIRECT_URI?.trim();
  if (!redirectUri) {
    const nextAuth = process.env.NEXTAUTH_URL?.trim();
    const vercel = process.env.VERCEL_URL?.trim();
    const baseUrl = nextAuth
      ? nextAuth.replace(/\/+$/, "")
      : vercel
        ? `https://${vercel.replace(/^https?:\/\//, "").split("/")[0]}`
        : process.env.NODE_ENV === "production"
          ? "https://www.inwcommunity.com"
          : "http://localhost:3000";
    redirectUri = `${baseUrl}/api/wix/oauth/callback`;
  } else {
    redirectUri = redirectUri.replace(/\/+$/, "");
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
