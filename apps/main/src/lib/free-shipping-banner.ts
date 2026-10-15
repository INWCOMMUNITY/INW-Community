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
 * The banner is shown only when both are true:
 * every active item ships free, and the seller saved a free-shipping purchase amount.
 */
export function freeShippingBannerForStore(args: {
  freeShippingMinimumCents?: number | null;
  items: ShippingItem[];
}): FreeShippingBanner | null {
  const allFree = args.items.length > 0 && args.items.every(itemHasFreeShipping);
  if (allFree && (args.freeShippingMinimumCents ?? 0) > 0) return "threshold";
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
