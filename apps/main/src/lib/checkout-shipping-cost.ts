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
  /** When every INW listing ships free, the purchases-over amount is ignored. */
  offerFreeShippingOnInw?: boolean;
};

export type SellerShippingLine = {
  quantity: number;
  fulfillmentType?: string | null;
  shippingCostCents?: number | null;
  /** Set when the line is a listing, so different products from one storefront count as one shipment. */
  storeItemId?: string | null;
};

/** One shipment per storefront. A business id wins; otherwise the seller; never a single listing id when a seller is known. */
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

/** True when this storefront shipment is more than a single unit of one listing. */
export function storefrontShipmentIsCombined(lines: SellerShippingLine[]): boolean {
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
      storeItemId: line.storeItemId,
      quantity: line.quantity,
      fulfillmentType: line.fulfillmentType,
      shippingCostCents: itemMap.get(line.storeItemId)?.shippingCostCents,
    })),
    merchandiseCents: opts?.merchandiseCents ?? 0,
    rules: opts?.rules,
  });
}
