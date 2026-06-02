import type { ChannelProvider } from "./types";
import { ETSY_SCOPES, isEtsyConfigured } from "./etsy/config";
import { EBAY_SCOPES, getEbayConfig, isEbayConfigured } from "./ebay/config";
import { isWixConfigured } from "./wix/config";
import { isShopifyConfigured, SHOPIFY_SCOPES } from "./shopify/config";
import { verifyShopifyCallbackHmac } from "./shopify/oauth";
import type { NextRequest } from "next/server";

/**
 * Per-provider OAuth wiring used by the generic connect/callback routes. Each adapter owns its
 * API calls; this only describes the bits the routes need (configured check, scopes to persist,
 * and the redirect_uri value handed to the provider).
 */
export type OAuthProviderProfile = {
  isConfigured(): boolean;
  /** Space-joined scope string stored on the connection. */
  scopes: string;
  /** Value passed as redirect_uri to the provider (callback URL, or eBay RuName). */
  redirectUri(baseUrl: string): string;
  notConfiguredMessage: string;
  /** Human label for error messages. */
  label: string;
  /** Optional callback validation before code exchange (e.g. Shopify HMAC). */
  verifyCallback?(req: NextRequest): boolean;
};

const PROFILES: Partial<Record<ChannelProvider, OAuthProviderProfile>> = {
  etsy: {
    isConfigured: isEtsyConfigured,
    scopes: ETSY_SCOPES.join(" "),
    redirectUri: (baseUrl) =>
      process.env.ETSY_REDIRECT_URI?.trim() || `${baseUrl}/api/channels/etsy/callback`,
    notConfiguredMessage: "Etsy sync is not configured on the server.",
    label: "Etsy",
  },
  ebay: {
    isConfigured: isEbayConfigured,
    // eBay's redirect_uri is the RuName, not a URL; the browser is sent to the eBay-configured URL.
    scopes: EBAY_SCOPES.join(" "),
    redirectUri: () => {
      try {
        return getEbayConfig().ruName;
      } catch {
        return "";
      }
    },
    notConfiguredMessage: "eBay sync is not configured on the server.",
    label: "eBay",
  },
  wix: {
    isConfigured: isWixConfigured,
    // Wix uses the External Install Flow + client-credentials tokens (no OAuth scopes persisted).
    scopes: "",
    redirectUri: (baseUrl) =>
      process.env.WIX_REDIRECT_URI?.trim() || `${baseUrl}/api/channels/wix/callback`,
    notConfiguredMessage: "Wix sync is not configured on the server.",
    label: "Wix",
  },
  shopify: {
    isConfigured: isShopifyConfigured,
    scopes: SHOPIFY_SCOPES.join(","),
    redirectUri: (baseUrl) =>
      process.env.SHOPIFY_REDIRECT_URI?.trim() || `${baseUrl}/api/channels/shopify/callback`,
    notConfiguredMessage: "Shopify sync is not configured on the server.",
    label: "Shopify",
    verifyCallback(req) {
      return verifyShopifyCallbackHmac(new URL(req.url).searchParams);
    },
  },
};

export function getOAuthProfile(provider: ChannelProvider): OAuthProviderProfile | null {
  return PROFILES[provider] ?? null;
}
