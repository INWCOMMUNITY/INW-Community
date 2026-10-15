import type { Prisma } from "database";

/**
 * Store item ended status utilities.
 * Channel sync functionality has been removed; these functions now return
 * false/empty as placeholders.
 */

/** How long an ended listing stays on the seller's Ended tab. Rows are kept for order history. */
export const ENDED_LISTING_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function endedListingRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - ENDED_LISTING_RETENTION_MS);
}

/**
 * Ended listings the seller can still see and relist.
 * Older than 14 days, or cleared early, stay in the database but leave this list.
 */
export function visibleEndedStoreItemWhere(
  memberId: string,
  now = new Date()
): Prisma.StoreItemWhereInput {
  const cutoff = endedListingRetentionCutoff(now);
  return {
    memberId,
    status: "inactive",
    OR: [
      { endedAt: { gt: cutoff } },
      { endedAt: null, updatedAt: { gt: cutoff } },
    ],
  };
}

export function hasLinkedChannelListings(_items: unknown[]): boolean {
  void _items;
  // No channel links anymore
  return false;
}

export function computeEffectiveEndedForBulk(
  _items: unknown[],
  _value: boolean
): Map<string, boolean> {
  void _items;
  void _value;
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
    // Ending the listing — stamp endedAt (retained; not a purge timer)
    return { status: "inactive", endedAt: now ?? new Date() };
  }
  if (nextStatus === "active" && currentStatus === "inactive") {
    // Relisting — clear endedAt
    return { status: "active", endedAt: null };
  }
  // No change to timer
  return { status: nextStatus };
}
