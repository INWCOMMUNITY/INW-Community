export type FreeShippingBanner = "storewide" | "threshold";

type ShippingItem = {
  shippingDisabled?: boolean | null;
  shippingCostCents?: number | null;
};

/** An item has free shipping when buyers can ship it and the shipping price is $0. */
export function itemHasFreeShipping(item: ShippingItem): boolean {
  if (item.shippingDisabled) return false;
  return item.shippingCostCents === 0;
}

/**
 * Show the purchase-amount banner when the seller saved one.
 * Otherwise show the storewide line only when every active item ships free.
 * Hide it when some items charge for shipping and no amount is set.
 */
export function freeShippingBannerForStore(args: {
  freeShippingMinimumCents?: number | null;
  offerFreeShippingOnInw?: boolean | null;
  items: ShippingItem[];
}): FreeShippingBanner | null {
  if (!args.offerFreeShippingOnInw && (args.freeShippingMinimumCents ?? 0) > 0) return "threshold";
  const allFree = args.items.length > 0 && args.items.every(itemHasFreeShipping);
  if (allFree) return "storewide";
  return null;
}

export function freeShippingBannerText(
  name: string,
  banner: FreeShippingBanner,
  minimumCents: number | null | undefined
): string {
  if (banner === "threshold" && minimumCents != null && minimumCents > 0) {
    return `${name} offers free shipping if you purchase $${(minimumCents / 100).toFixed(2)} worth from their store!`;
  }
  return `${name} offers free shipping from their store!`;
}
