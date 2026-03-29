import { Platform } from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";

/**
 * Public website origin (https, no /api suffix). Used for Apple Pay recurring `managementUrl`
 * and must match a real page where members can manage billing.
 */
export function stripeWalletSiteBase(): string {
  return API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
}

/** Must match Apple Developer Merchant ID and Stripe Apple Pay settings / EAS env. */
export const STRIPE_APPLE_PAY_MERCHANT_ID =
  process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ?? "merchant.com.northwestcommunity";

export function logApplePayDiagnostics(tag: string, message: string, extra?: Record<string, unknown>): void {
  if (__DEV__ && Platform.OS === "ios") {
    console.warn(`[ApplePay:${tag}]`, message, extra ?? "");
  }
}
