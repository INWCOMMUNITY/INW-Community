/** Display amounts for marketing / UI (align with Stripe prices and support-nwc copy). */

type PlanPrices = { monthlyUsd: number };

export const SUBSCRIPTION_PLAN_PRICES = {
  subscribe: { monthlyUsd: 10 },
  sponsor: { monthlyUsd: 10 },
  seller: { monthlyUsd: 20 },
} as const satisfies Record<string, PlanPrices>;

export type SubscriptionCheckoutPlanId = keyof typeof SUBSCRIPTION_PLAN_PRICES;

export function getSubscriptionPlanPrices(planId: string) {
  return SUBSCRIPTION_PLAN_PRICES[planId as SubscriptionCheckoutPlanId] ?? null;
}

/** New checkout is monthly-only. Existing yearly Stripe prices may still be mapped in env. */
export function planHasYearlyBilling(_planId: string): boolean {
  return false;
}

/** Unused by checkout now that yearly is off; kept for older callers. */
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
  if (interval === "yearly") return null;
  if (planId === "subscribe") {
    return { primary: "$1-$15/mo" };
  }
  return { primary: `$${p.monthlyUsd.toFixed(2)} per month` };
}
