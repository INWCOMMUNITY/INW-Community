/** Helpers for Stripe-native $25 → $10 Business monthly proration. */

export const LEGACY_BUSINESS_MONTHLY_CENTS = 2500;
export const NEW_BUSINESS_MONTHLY_CENTS = 1000;

export const NWC_PRICE_PRORATED_META = "nwcPriceProratedAt";

export function formatUsdFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Sum Stripe invoice line amounts marked as prorations (negative = unused-time credit). */
export function sumProrationLineCents(lines: { amount?: number | null; proration?: boolean | null }[]): number {
  let total = 0;
  for (const line of lines) {
    if (!line.proration) continue;
    if (typeof line.amount === "number") total += line.amount;
  }
  return total;
}
