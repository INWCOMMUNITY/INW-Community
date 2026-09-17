import type { Prisma } from "database";

/**
 * Historical filter for the old 14-day physical purge. Kept for diagnostics only.
 * Physical StoreItem delete is no longer performed.
 */
export function endedListingPurgeWhere(cutoff: Date): Prisma.StoreItemWhereInput {
  return {
    status: "inactive",
    endedAt: { lte: cutoff },
    orderItems: { none: {} },
    resaleOffers: { none: {} },
  };
}

/**
 * History-safe no-op. Ended listings are retained (logical End via inactive + endedAt).
 * Does not physically delete StoreItems or cascade OrderItems.
 */
export async function deleteEndedListingsPastRetention(
  _now = new Date()
): Promise<{ deleted: number; skipped: true }> {
  return { deleted: 0, skipped: true };
}
