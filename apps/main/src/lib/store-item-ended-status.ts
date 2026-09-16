/**
 * Store item ended status utilities.
 * Channel sync functionality has been removed; these functions now return
 * false/empty as placeholders.
 */

/** 14 days retention period before ended listings are purged. */
export const ENDED_LISTING_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function hasLinkedChannelListings(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _items: unknown[]
): boolean {
  // No channel links anymore
  return false;
}

export function computeEffectiveEndedForBulk(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _items: unknown[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _value: boolean
): Map<string, boolean> {
  // No channel links anymore - return empty map
  return new Map();
}

/**
 * Returns the Prisma update data to mark a listing as inactive.
 * Used when bulk-ending listings.
 */
export function inactiveStoreItemData(): { status: "inactive"; endedAt: Date } {
  return { status: "inactive", endedAt: new Date() };
}

/**
 * Build the Prisma update data for changing listing status.
 * Sets endedAt when ending a listing, clears it when relisting.
 */
export function storeItemStatusWrite(
  nextStatus: "active" | "inactive" | "sold_out" | "draft",
  currentStatus: string = "active",
  now?: Date
): { status: string; endedAt?: Date | null } {
  // Handle sold_out and draft as status-only changes (not ending)
  if (nextStatus === "sold_out" || nextStatus === "draft") {
    return { status: nextStatus };
  }
  if (nextStatus === "inactive" && currentStatus !== "inactive") {
    // Ending the listing — stamp the timer
    return { status: "inactive", endedAt: now ?? new Date() };
  }
  if (nextStatus === "active" && currentStatus === "inactive") {
    // Relisting — clear the timer
    return { status: "active", endedAt: null };
  }
  // No change to timer
  return { status: nextStatus };
}
