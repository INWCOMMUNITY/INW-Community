/** Display amounts for marketing / UI (align with Stripe prices and support-nwc copy). */

type SubscribePrices = { monthlyUsd: number };
type SponsorSellerPrices = { monthlyUsd: number; yearlyUsd: number };

export const SUBSCRIPTION_PLAN_PRICES = {
  subscribe: { monthlyUsd: 10 },
  sponsor: { monthlyUsd: 10, yearlyUsd: 100 },
  seller: { monthlyUsd: 20, yearlyUsd: 200 },
} as const satisfies Record<string, SubscribePrices | SponsorSellerPrices>;

export type SubscriptionCheckoutPlanId = keyof typeof SUBSCRIPTION_PLAN_PRICES;

export function getSubscriptionPlanPrices(planId: string) {
  return SUBSCRIPTION_PLAN_PRICES[planId as SubscriptionCheckoutPlanId] ?? null;
}

/** Business and Seller offer yearly checkout; residents stay monthly (pay what you can). */
export function planHasYearlyBilling(planId: string): boolean {
  const p = getSubscriptionPlanPrices(planId);
  return !!(p && "yearlyUsd" in p);
}

export function defaultYearlyToggleLabel(_planId: string): string {
  return "Yearly";
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
      return { primary: "$1–$15/mo" };
    }
    return { primary: `$${p.monthlyUsd.toFixed(2)} per month` };
  }
  if (!("yearlyUsd" in p)) return null;
  return {
    primary: `$${p.yearlyUsd.toFixed(2)} per year`,
    secondary: `About $${(p.yearlyUsd / 12).toFixed(2)}/mo billed annually`,
  };
}
