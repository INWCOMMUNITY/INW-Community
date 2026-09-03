/** Stripe Price IDs for NWC subscription checkout (see root `.env.example`). */

const SUBSCRIBE_TIER_COUNT = 15;

function trimPriceId(raw: string | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function subscribeTierEnvKeyPadded(index1Based: number): string {
  return `STRIPE_PRICE_SUBSCRIBE_TIER_${String(index1Based).padStart(2, "0")}`;
}

/** TIER_01 … TIER_15 plus TIER_1 … TIER_9 (unpadded) for common .env typos. */
function subscribeTierEnvKeys(index1Based: number): string[] {
  const padded = subscribeTierEnvKeyPadded(index1Based);
  if (index1Based <= 9) {
    const unpadded = `STRIPE_PRICE_SUBSCRIBE_TIER_${index1Based}`;
    return padded === unpadded ? [padded] : [padded, unpadded];
  }
  return [padded];
}

/**
 * Single `STRIPE_PRICE_SUBSCRIBE` if set; otherwise first non-empty
 * `STRIPE_PRICE_SUBSCRIBE_TIER_01` … `TIER_15` (and `TIER_1`…`TIER_9`).
 */
export function resolveSubscribeMonthlyStripePriceId(): string {
  const single = trimPriceId(process.env.STRIPE_PRICE_SUBSCRIBE);
  if (single) return single;
  for (let i = 1; i <= SUBSCRIBE_TIER_COUNT; i++) {
    for (const key of subscribeTierEnvKeys(i)) {
      const v = trimPriceId(process.env[key]);
      if (v) return v;
    }
  }
  return "";
}

/** Stripe price id for resident tier $1 … $15 / mo (env tier keys). */
export function resolveSubscribeStripePriceIdForDollarTier(dollars: number): string | null {
  if (!Number.isInteger(dollars) || dollars < 1 || dollars > 15) return null;
  for (const key of subscribeTierEnvKeys(dollars)) {
    const v = trimPriceId(process.env[key]);
    if (v) return v;
  }
  return null;
}

/**
 * Checkout with a chosen PWYC dollar amount: use `STRIPE_PRICE_SUBSCRIBE_TIER_NN` when set;
 * if that tier is not configured but `STRIPE_PRICE_SUBSCRIBE` (single monthly price) is set, use that.
 * Returns null only when neither applies (caller should 400).
 */
export function resolveSubscribeMonthlyPriceForTierSelection(dollars: number): string | null {
  const tier = resolveSubscribeStripePriceIdForDollarTier(dollars);
  if (tier) return tier;
  const single = trimPriceId(process.env.STRIPE_PRICE_SUBSCRIBE);
  if (single) return single;
  return null;
}

/** All configured resident subscribe price IDs (deduped). For admin stats / allowlists. */
export function collectSubscribeStripePriceIds(): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    const t = id.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(trimPriceId(process.env.STRIPE_PRICE_SUBSCRIBE));
  for (let i = 1; i <= SUBSCRIBE_TIER_COUNT; i++) {
    for (const key of subscribeTierEnvKeys(i)) {
      push(trimPriceId(process.env[key]));
    }
  }
  return out;
}

export type StripePlanPriceConfig = { priceId: string; priceIdYearly?: string };

function uniquePriceIds(raw: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of raw) {
    const t = trimPriceId(value);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Current + optional leftover monthly Business price ids. */
export function collectSponsorMonthlyStripePriceIds(): string[] {
  return uniquePriceIds([process.env.STRIPE_PRICE_SPONSOR, process.env.STRIPE_PRICE_SPONSOR_LEGACY]);
}

/** Current + optional leftover monthly Seller price ids. */
export function collectSellerMonthlyStripePriceIds(): string[] {
  return uniquePriceIds([process.env.STRIPE_PRICE_SELLER, process.env.STRIPE_PRICE_SELLER_LEGACY]);
}

/**
 * Yearly Business price ids. New `STRIPE_PRICE_SPONSOR_YEARLY` first; leftover summer-named
 * env vars still map existing annual subscribers if they were never renamed.
 */
export function collectSponsorYearlyStripePriceCandidates(): string[] {
  return uniquePriceIds([
    process.env.STRIPE_PRICE_SPONSOR_YEARLY,
    process.env.STRIPE_PRICE_BUSINESS_SUMMER_STARTUP_YEARLY,
    process.env.STRIPE_PRICE_SPONSOR_SUMMER_STARTUP_YEARLY,
  ]);
}

/** First configured Business yearly price id (for static config / hints). Prefer {@link collectSponsorYearlyStripePriceCandidates} at checkout. */
export function resolveSponsorYearlyStripePriceId(): string {
  return collectSponsorYearlyStripePriceCandidates()[0] ?? "";
}

/** Yearly Seller price ids. New `STRIPE_PRICE_SELLER_YEARLY` first; leftover summer-named env optional. */
export function collectSellerYearlyStripePriceCandidates(): string[] {
  return uniquePriceIds([
    process.env.STRIPE_PRICE_SELLER_YEARLY,
    process.env.STRIPE_PRICE_SELLER_SUMMER_STARTUP_YEARLY,
  ]);
}

/** Every Business price id that should grant `sponsor` access (monthly + yearly). */
export function collectSponsorStripePriceIds(): string[] {
  return uniquePriceIds([...collectSponsorMonthlyStripePriceIds(), ...collectSponsorYearlyStripePriceCandidates()]);
}

/** Every Seller price id that should grant `seller` access (monthly + yearly). */
export function collectSellerStripePriceIds(): string[] {
  return uniquePriceIds([...collectSellerMonthlyStripePriceIds(), ...collectSellerYearlyStripePriceCandidates()]);
}

/** First configured Seller yearly price id. Prefer {@link collectSellerYearlyStripePriceCandidates} at checkout. */
export function resolveSellerYearlyStripePriceId(): string {
  return collectSellerYearlyStripePriceCandidates()[0] ?? "";
}

export function getStripeSubscriptionPlanPriceIds(): Record<string, StripePlanPriceConfig> {
  const subscribeYearly = trimPriceId(process.env.STRIPE_PRICE_SUBSCRIBE_YEARLY);
  return {
    subscribe: {
      priceId: resolveSubscribeMonthlyStripePriceId(),
      ...(subscribeYearly ? { priceIdYearly: subscribeYearly } : {}),
    },
    sponsor: {
      priceId: trimPriceId(process.env.STRIPE_PRICE_SPONSOR),
      priceIdYearly: resolveSponsorYearlyStripePriceId(),
    },
    seller: {
      priceId: trimPriceId(process.env.STRIPE_PRICE_SELLER),
      priceIdYearly: resolveSellerYearlyStripePriceId(),
    },
  };
}

/** Resolves the Stripe Price id, or null if the requested interval is not configured. */
export function resolveStripeSubscriptionPriceId(
  plans: Record<string, StripePlanPriceConfig>,
  planId: string,
  interval: "monthly" | "yearly"
): string | null {
  const p = plans[planId];
  if (!p) return null;
  if (interval === "yearly") {
    const y = p.priceIdYearly?.trim();
    return y || null;
  }
  const m = p.priceId?.trim();
  return m || null;
}

/** User-facing hint when checkout cannot resolve a Stripe price (no secrets). */
export function describeStripeSubscriptionConfigError(planId: string, interval: "monthly" | "yearly"): string {
  const id = planId.trim().toLowerCase();
  if (id !== "subscribe" && id !== "sponsor" && id !== "seller") {
    return `Unknown plan. Use subscribe, sponsor, or seller (received: "${planId.trim() || "(empty)"}").`;
  }
  if (interval === "yearly") {
    if (id === "subscribe") {
      return "Resident yearly is not configured. Set STRIPE_PRICE_SUBSCRIBE_YEARLY, or choose monthly with STRIPE_PRICE_SUBSCRIBE or STRIPE_PRICE_SUBSCRIBE_TIER_01–15.";
    }
    if (id === "sponsor") {
      return "Annual Business is not configured. Set STRIPE_PRICE_SPONSOR_YEARLY to your Business yearly Stripe price id.";
    }
    return "Annual Seller is not configured. Set STRIPE_PRICE_SELLER_YEARLY to your Seller yearly Stripe price id.";
  }
  if (id === "subscribe") {
    return "Resident subscribe is not configured on the server. Set STRIPE_PRICE_SUBSCRIBE or STRIPE_PRICE_SUBSCRIBE_TIER_01 (…TIER_15) in the deployment environment to valid Stripe price_ ids.";
  }
  if (id === "sponsor") {
    return "Business monthly price is not configured. Set STRIPE_PRICE_SPONSOR to your Stripe monthly price id.";
  }
  return "Seller monthly price is not configured. Set STRIPE_PRICE_SELLER to your Stripe monthly price id.";
}
