/**
 * Keep in sync with apps/main/src/lib/checkout-shipping-cost.ts sellerOrderShippingCents.
 * Metro cannot import the website module.
 */

export type SellerShippingRules = {
  combineShipping: boolean;
  combinedShippingMaxCents: number | null;
  freeShippingMinimumCents: number | null;
  /** When every INW listing ships free, the purchases-over amount is ignored. */
  offerFreeShippingOnInw?: boolean;
};

export function storefrontGroupKey(item: {
  businessId?: string | null;
  memberId?: string | null;
  storeItemId?: string | null;
}): string {
  const businessId = item.businessId?.trim();
  if (businessId) return businessId;
  const memberId = item.memberId?.trim();
  if (memberId) return memberId;
  return item.storeItemId?.trim() || "unknown";
}

export function storefrontShipmentIsCombined(
  lines: Array<{
    quantity: number;
    fulfillmentType?: string | null;
    storeItemId?: string | null;
  }>
): boolean {
  let units = 0;
  let listings = 0;
  const listingIds = new Set<string>();
  for (const line of lines) {
    if ((line.fulfillmentType ?? "ship") !== "ship") continue;
    const qty = line.quantity > 0 ? line.quantity : 0;
    if (qty === 0) continue;
    units += qty;
    listings += 1;
    const id = line.storeItemId?.trim();
    if (id) listingIds.add(id);
  }
  return units > 1 || listings > 1 || listingIds.size > 1;
}

export function sellerOrderShippingQuote(args: {
  lines: Array<{
    quantity: number;
    fulfillmentType?: string | null;
    shippingCostCents?: number | null;
    storeItemId?: string | null;
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

  const minimum = args.rules?.offerFreeShippingOnInw ? null : args.rules?.freeShippingMinimumCents;
  if (minimum != null && minimum > 0 && args.merchandiseCents >= minimum) {
    return { cents: 0, combinedCapApplied: false };
  }

  const max = args.rules?.combinedShippingMaxCents;
  if (args.rules?.combineShipping && max != null && storefrontShipmentIsCombined(args.lines)) {
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
    storeItemId?: string | null;
  }>;
  merchandiseCents: number;
  rules?: SellerShippingRules | null;
}): number {
  return sellerOrderShippingQuote(args).cents;
}
