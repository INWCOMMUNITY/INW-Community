/**
 * Keep in sync with apps/main/src/lib/checkout-shipping-cost.ts sellerOrderShippingCents.
 * Metro cannot import the website module.
 */

export type SellerShippingRules = {
  combineShipping: boolean;
  combinedShippingMaxCents: number | null;
  freeShippingMinimumCents: number | null;
};

export function sellerOrderShippingQuote(args: {
  lines: Array<{
    quantity: number;
    fulfillmentType?: string | null;
    shippingCostCents?: number | null;
  }>;
  merchandiseCents: number;
  rules?: SellerShippingRules | null;
}): { cents: number; combinedCapApplied: boolean } {
  let lineShipping = 0;
  let shippedUnits = 0;
  for (const line of args.lines) {
    if ((line.fulfillmentType ?? "ship") !== "ship") continue;
    const qty = line.quantity > 0 ? line.quantity : 0;
    shippedUnits += qty;
    const unit = line.shippingCostCents;
    if (unit != null && unit > 0 && qty > 0) lineShipping += unit * qty;
  }
  if (shippedUnits === 0) return { cents: 0, combinedCapApplied: false };

  const minimum = args.rules?.freeShippingMinimumCents;
  if (minimum != null && minimum > 0 && args.merchandiseCents >= minimum) {
    return { cents: 0, combinedCapApplied: false };
  }

  const max = args.rules?.combinedShippingMaxCents;
  if (args.rules?.combineShipping && max != null && shippedUnits > 1) {
    const cap = Math.max(0, max);
    const cents = Math.min(lineShipping, cap);
    return { cents, combinedCapApplied: lineShipping > cap && cents > 0 };
  }
  return { cents: lineShipping, combinedCapApplied: false };
}

export function sellerOrderShippingCents(args: {
  lines: Array<{
    quantity: number;
    fulfillmentType?: string | null;
    shippingCostCents?: number | null;
  }>;
  merchandiseCents: number;
  rules?: SellerShippingRules | null;
}): number {
  return sellerOrderShippingQuote(args).cents;
}
