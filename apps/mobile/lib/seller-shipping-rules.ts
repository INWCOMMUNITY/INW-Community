/**
 * Keep in sync with apps/main/src/lib/checkout-shipping-cost.ts sellerOrderShippingCents.
 * Metro cannot import the website module.
 */

export type SellerShippingRules = {
  combineShipping: boolean;
  combinedShippingMaxCents: number | null;
  freeShippingMinimumCents: number | null;
};

export function sellerOrderShippingCents(args: {
  lines: Array<{
    quantity: number;
    fulfillmentType?: string | null;
    shippingCostCents?: number | null;
  }>;
  merchandiseCents: number;
  rules?: SellerShippingRules | null;
}): number {
  let lineShipping = 0;
  let shippedUnits = 0;
  for (const line of args.lines) {
    if ((line.fulfillmentType ?? "ship") !== "ship") continue;
    const qty = line.quantity > 0 ? line.quantity : 0;
    shippedUnits += qty;
    const unit = line.shippingCostCents;
    if (unit != null && unit > 0 && qty > 0) lineShipping += unit * qty;
  }
  if (shippedUnits === 0) return 0;

  const minimum = args.rules?.freeShippingMinimumCents;
  if (minimum != null && minimum > 0 && args.merchandiseCents >= minimum) return 0;

  const max = args.rules?.combinedShippingMaxCents;
  if (args.rules?.combineShipping && max != null && shippedUnits > 1) {
    return Math.min(lineShipping, Math.max(0, max));
  }
  return lineShipping;
}
