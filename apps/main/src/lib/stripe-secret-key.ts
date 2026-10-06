/**
 * Resolve Stripe secret keys from env (trimmed). Returns null if missing or still a placeholder.
 *
 * Two accounts:
 * - Billing / subscriptions → STRIPE_SECRET_KEY (Northwest Community)
 * - Marketplace / Connect / storefront → STRIPE_MARKETPLACE_SECRET_KEY (NWC Marketplace)
 *
 * Production never falls back to STRIPE_SECRET_KEY for marketplace calls. Local/dev may fall back
 * only when STRIPE_MARKETPLACE_SECRET_KEY is completely unset.
 */

export function isUsableSecretKey(key: string | undefined | null): key is string {
  const k = key?.trim() ?? "";
  if (!k) return false;
  if (!k.startsWith("sk_")) return false;
  if (k === "sk_test_..." || k === "sk_live_...") return false;
  // Real Stripe secret keys are long; placeholders from .env.example are short.
  if (k.length < 24) return false;
  return true;
}

/** Safe shape of a secret for diagnostics — never returns the key itself. */
export function describeSecretKeyShape(key: string | undefined | null): {
  present: boolean;
  usable: boolean;
  prefix: string | null;
  length: number;
  last4: string | null;
} {
  const k = key?.trim() ?? "";
  if (!k) {
    return { present: false, usable: false, prefix: null, length: 0, last4: null };
  }
  const prefixMatch = k.match(/^(sk_live_|sk_test_|rk_live_|rk_test_|pk_live_|pk_test_|whsec_)/);
  return {
    present: true,
    usable: isUsableSecretKey(k),
    prefix: prefixMatch?.[1] ?? k.slice(0, Math.min(8, k.length)),
    length: k.length,
    last4: k.length >= 4 ? k.slice(-4) : k,
  };
}

function allowMarketplaceSecretFallback(): boolean {
  // Preview/Production on Vercel must use the dedicated marketplace key.
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    return false;
  }
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
 * Uses STRIPE_MARKETPLACE_SECRET_KEY only. Falls back to STRIPE_SECRET_KEY only in local/dev
 * when the marketplace var is completely unset — never when it is set but unusable.
 */
export function resolveMarketplaceStripeSecretKey(): string | null {
  const raw = process.env.STRIPE_MARKETPLACE_SECRET_KEY;
  const marketplace = raw?.trim() ?? "";
  if (marketplace) {
    return isUsableSecretKey(marketplace) ? marketplace : null;
  }
  if (allowMarketplaceSecretFallback()) {
    return resolveStripeSecretKey();
  }
  return null;
}

export const STRIPE_NOT_CONFIGURED_MESSAGE =
  "Stripe is not configured. Add STRIPE_SECRET_KEY (sk_test_ or sk_live_) in apps/main/.env for local dev, or in the Vercel project environment for Production, then redeploy.";

export const STRIPE_MARKETPLACE_NOT_CONFIGURED_MESSAGE =
  "Marketplace Stripe is not configured. Set Production STRIPE_MARKETPLACE_SECRET_KEY to an sk_live_ key from the NWC Marketplace Stripe account (not Northwest Community), then redeploy. Restricted keys (rk_) and publishable keys (pk_) are rejected.";

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
