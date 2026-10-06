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
 * True when marketplace uses a distinct usable secret from billing (dual-account cutover).
 * False when marketplace env is missing/unusable or equals STRIPE_SECRET_KEY.
 */
export function isMarketplaceStripeSeparateFromBilling(): boolean {
  const billing = resolveBillingStripeSecretKey();
  const marketplace = resolveMarketplaceStripeSecretKey();
  if (!billing || !marketplace) return false;
  return marketplace !== billing;
}
