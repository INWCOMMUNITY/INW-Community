import type { CartItem, ResaleOffer, StoreItem } from "database";

type CartWithOffer = CartItem & { resaleOffer: ResaleOffer | null };

/** Server-trusted unit price for checkout when buyer has an accepted offer in cart. */
export function resolvedPriceForCartLine(
  storeItem: Pick<StoreItem, "priceCents">,
  cartRow: CartWithOffer | undefined,
  buyerId: string
): { unitPriceCents: number; resaleOfferId: string | null } {
  if (!cartRow?.resaleOfferId || cartRow.priceOverrideCents == null) {
    return { unitPriceCents: storeItem.priceCents, resaleOfferId: null };
  }
  const ro = cartRow.resaleOffer;
  if (!ro || ro.buyerId !== buyerId) {
    return { unitPriceCents: storeItem.priceCents, resaleOfferId: null };
  }
  if (ro.status !== "accepted" || !ro.checkoutDeadlineAt || ro.checkoutDeadlineAt <= new Date()) {
    return { unitPriceCents: storeItem.priceCents, resaleOfferId: null };
  }
  if (ro.finalAmountCents !== cartRow.priceOverrideCents) {
    return { unitPriceCents: storeItem.priceCents, resaleOfferId: null };
  }
  return { unitPriceCents: cartRow.priceOverrideCents, resaleOfferId: ro.id };
}
