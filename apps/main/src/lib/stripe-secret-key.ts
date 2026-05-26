/**
 * Resolve Stripe secret key from env (trimmed). Returns null if missing or still a placeholder.
 */
export function resolveStripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!key.startsWith("sk_")) return null;
  if (key === "sk_test_..." || key === "sk_live_...") return null;
  // Real Stripe secret keys are long; placeholders from .env.example are short.
  if (key.length < 24) return null;
  return key;
}

export const STRIPE_NOT_CONFIGURED_MESSAGE =
  "Stripe is not configured. Add STRIPE_SECRET_KEY (sk_test_ or sk_live_) in apps/main/.env for local dev, or in the Vercel project environment for Production, then redeploy.";

export function requireStripeSecretKey(): string {
  const key = resolveStripeSecretKey();
  if (!key) {
    throw new Error(STRIPE_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}
