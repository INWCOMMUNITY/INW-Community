/** Display amounts for marketing / UI (must match Stripe product pricing and support-nwc copy). */
export const SUBSCRIPTION_PLAN_PRICES = {
  subscribe: { monthlyUsd: 10, yearlyUsd: 100 },
  sponsor: { monthlyUsd: 25, yearlyUsd: 250 },
  seller: { monthlyUsd: 30, yearlyUsd: 325 },
} as const;

export type SubscriptionCheckoutPlanId = keyof typeof SUBSCRIPTION_PLAN_PRICES;

export function getSubscriptionPlanPrices(planId: string) {
  return SUBSCRIPTION_PLAN_PRICES[planId as SubscriptionCheckoutPlanId] ?? null;
}

/** Lines for under the billing interval toggle on single-plan pages. */
export function formatSubscriptionPriceForInterval(
  planId: string,
  interval: "monthly" | "yearly"
): { primary: string; secondary?: string } | null {
  const p = getSubscriptionPlanPrices(planId);
  if (!p) return null;
  if (interval === "monthly") {
    return { primary: `$${p.monthlyUsd.toFixed(2)} per month` };
  }
  const perMonth = (p.yearlyUsd / 12).toFixed(2);
  return {
    primary: `$${p.yearlyUsd.toFixed(2)} per year`,
    secondary: `$${perMonth} / month billed annually`,
  };
}
