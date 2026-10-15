/**
 * Server-side shipping for storefront checkout. Never trust client `shippingCostCents`.
 *
 * Without rules, each shipped line's price is multiplied by quantity and added up.
 * Combine shipping caps that total when more than one item ships in the same seller order.
 * Free shipping over a store total zeros shipping once merchandise reaches the seller's amount.
 */

export type SellerShippingRules = {
  combineShipping: boolean;
  combinedShippingMaxCents: number | null;
  freeShippingMinimumCents: number | null;
};

export type SellerShippingLine = {
  quantity: number;
  fulfillmentType?: string | null;
  shippingCostCents?: number | null;
};

export function sellerOrderShippingQuote(args: {
  lines: SellerShippingLine[];
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
  lines: SellerShippingLine[];
  merchandiseCents: number;
  rules?: SellerShippingRules | null;
}): number {
  return sellerOrderShippingQuote(args).cents;
}

export function shippingCentsForSellerLines(
  sellerItems: Array<{ storeItemId: string; quantity: number; fulfillmentType?: string }>,
  itemMap: Map<string, { shippingCostCents?: number | null }>,
  opts?: { merchandiseCents?: number; rules?: SellerShippingRules | null }
): number {
  return sellerOrderShippingCents({
    lines: sellerItems.map((line) => ({
      quantity: line.quantity,
      fulfillmentType: line.fulfillmentType,
      shippingCostCents: itemMap.get(line.storeItemId)?.shippingCostCents,
    })),
    merchandiseCents: opts?.merchandiseCents ?? 0,
    rules: opts?.rules,
  });
}
