/**
 * A blank shipping price must not erase a price already saved on the listing.
 * An explicit number, including 0 for free shipping, is applied as sent.
 */
export function listingShippingCostUpdate(
  existingCents: number | null | undefined,
  incomingCents: number | null
): number | null {
  if (incomingCents == null && existingCents != null && existingCents > 0) {
    return existingCents;
  }
  return incomingCents;
}
