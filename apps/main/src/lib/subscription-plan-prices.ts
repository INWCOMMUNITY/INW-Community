/** Display amounts for marketing / UI (align with Stripe prices and support-nwc copy). */

type SubscribePrices = { monthlyUsd: number };
type SponsorSellerPrices = { monthlyUsd: number; yearlyUsd: number; yearlyIsSummerPromo: true };

export const SUBSCRIPTION_PLAN_PRICES = {
  subscribe: { monthlyUsd: 10 },
  sponsor: { monthlyUsd: 25, yearlyUsd: 100, yearlyIsSummerPromo: true },
  seller: { monthlyUsd: 30, yearlyUsd: 100, yearlyIsSummerPromo: true },
} as const satisfies Record<string, SubscribePrices | SponsorSellerPrices>;

export type SubscriptionCheckoutPlanId = keyof typeof SUBSCRIPTION_PLAN_PRICES;

export function getSubscriptionPlanPrices(planId: string) {
  return SUBSCRIPTION_PLAN_PRICES[planId as SubscriptionCheckoutPlanId] ?? null;
}

/** Resident plan is monthly-only (pay-what-you-can tiers at checkout). */
export function planHasYearlyBilling(planId: string): boolean {
  const p = getSubscriptionPlanPrices(planId);
  return !!(p && "yearlyUsd" in p);
}

/** Default label for the non-monthly toggle (Business/Seller annual = Summer promo). */
export function defaultYearlyToggleLabel(planId: string): string {
  return planId === "sponsor" || planId === "seller" ? "Annual (Summer)" : "Yearly";
}

/** Lines for under the billing interval toggle on single-plan pages. */
export function formatSubscriptionPriceForInterval(
  planId: string,
  interval: "monthly" | "yearly"
): { primary: string; secondary?: string } | null {
  const p = getSubscriptionPlanPrices(planId);
  if (!p) return null;
  if (interval === "monthly") {
    if (planId === "subscribe") {
      return { primary: "$1-$15/mo" };
    }
    return { primary: `$${p.monthlyUsd.toFixed(2)} per month` };
  }
  if (!("yearlyUsd" in p)) return null;
  const perMonth = (p.yearlyUsd / 12).toFixed(2);
  return {
    primary: `$${p.yearlyUsd.toFixed(2)} per year`,
    secondary: p.yearlyIsSummerPromo
      ? `Summer Startup Promo — about $${perMonth}/mo billed annually`
      : `$${perMonth} / month billed annually`,
  };
}
