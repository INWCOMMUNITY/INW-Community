/**
 * When a listing has a positive price, buyer offers and seller counters must not exceed it.
 * @returns API error message, or null if valid (or no ceiling when price unset).
 */
export function resaleOfferExceedsListPriceMessage(
  amountCents: number,
  listPriceCents: number | null | undefined
): string | null {
  if (listPriceCents == null || listPriceCents < 1) return null;
  if (amountCents > listPriceCents) {
    return "Offer cannot exceed the listing price.";
  }
  return null;
}
