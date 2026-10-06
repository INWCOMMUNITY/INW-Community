import Stripe from "stripe";
import {
  requireBillingStripeSecretKey,
  requireMarketplaceStripeSecretKey,
  resolveBillingStripeSecretKey,
  resolveMarketplaceStripeSecretKey,
  STRIPE_API_VERSION,
} from "@/lib/stripe-secret-key";

/** Northwest Community — subscriptions / directory billing. */
export function createBillingStripe(): Stripe {
  return new Stripe(requireBillingStripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
}

/** NWC Marketplace — storefront Checkout, Connect, transfers, refunds. */
export function createMarketplaceStripe(): Stripe {
  return new Stripe(requireMarketplaceStripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
}

export function tryCreateBillingStripe(): Stripe | null {
  const key = resolveBillingStripeSecretKey();
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

export function tryCreateMarketplaceStripe(): Stripe | null {
  const key = resolveMarketplaceStripeSecretKey();
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

/**
 * True when marketplace uses a distinct secret from billing (dual-account cutover).
 * False when marketplace falls back to STRIPE_SECRET_KEY.
 */
export function isMarketplaceStripeSeparateFromBilling(): boolean {
  const billing = resolveBillingStripeSecretKey();
  const marketplace = process.env.STRIPE_MARKETPLACE_SECRET_KEY?.trim();
  if (!billing || !marketplace || marketplace.length < 24) return false;
  if (!marketplace.startsWith("sk_")) return false;
  return marketplace !== billing;
}
