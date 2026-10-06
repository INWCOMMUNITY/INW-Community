/**
 * Resolve Stripe secret keys from env (trimmed). Returns null if missing or still a placeholder.
 *
 * Two accounts:
 * - Billing / subscriptions → STRIPE_SECRET_KEY (Northwest Community)
 * - Marketplace / Connect / storefront → STRIPE_MARKETPLACE_SECRET_KEY (NWC Marketplace),
 *   falling back to STRIPE_SECRET_KEY when the marketplace key is not set (local / pre-cutover).
 */

function isUsableSecretKey(key: string | undefined | null): key is string {
  const k = key?.trim() ?? "";
  if (!k) return false;
  if (!k.startsWith("sk_")) return false;
  if (k === "sk_test_..." || k === "sk_live_...") return false;
  // Real Stripe secret keys are long; placeholders from .env.example are short.
  if (k.length < 24) return false;
  return true;
}

export function resolveStripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return isUsableSecretKey(key) ? key : null;
}

/** Subscriptions / directory billing on the original Northwest Community account. */
export function resolveBillingStripeSecretKey(): string | null {
  return resolveStripeSecretKey();
}

/**
 * Storefront Checkout, Connect, transfers, refunds, seller funds.
 * Prefer STRIPE_MARKETPLACE_SECRET_KEY; fall back to STRIPE_SECRET_KEY if unset.
 */
export function resolveMarketplaceStripeSecretKey(): string | null {
  const marketplace = process.env.STRIPE_MARKETPLACE_SECRET_KEY?.trim();
  if (isUsableSecretKey(marketplace)) return marketplace;
  return resolveStripeSecretKey();
}

export const STRIPE_NOT_CONFIGURED_MESSAGE =
  "Stripe is not configured. Add STRIPE_SECRET_KEY (sk_test_ or sk_live_) in apps/main/.env for local dev, or in the Vercel project environment for Production, then redeploy.";

export const STRIPE_MARKETPLACE_NOT_CONFIGURED_MESSAGE =
  "Marketplace Stripe is not configured. Add STRIPE_MARKETPLACE_SECRET_KEY (and related STRIPE_MARKETPLACE_* webhook secrets) for Production, or STRIPE_SECRET_KEY as a fallback for local storefront testing.";

export function requireStripeSecretKey(): string {
  const key = resolveStripeSecretKey();
  if (!key) {
    throw new Error(STRIPE_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}

export function requireBillingStripeSecretKey(): string {
  return requireStripeSecretKey();
}

export function requireMarketplaceStripeSecretKey(): string {
  const key = resolveMarketplaceStripeSecretKey();
  if (!key) {
    throw new Error(STRIPE_MARKETPLACE_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}

export const STRIPE_API_VERSION = "2024-11-20.acacia" as "2023-10-16";
