import type { Prisma } from "database";
import { prisma } from "database";
import { ENDED_LISTING_RETENTION_MS } from "@/lib/store-item-ended-status";

/**
 * Prisma filter: ended storefront records past retention, with no order history so we do not
 * wipe line items. Channel listings are not unpublished — only the INW row is deleted.
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
 * Hard-deletes matching StoreItems (cascades INW links/cart rows). Does not call channel delete APIs.
 */
export async function deleteEndedListingsPastRetention(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - ENDED_LISTING_RETENTION_MS);
  const result = await prisma.storeItem.deleteMany({
    where: endedListingPurgeWhere(cutoff),
  });
  return { deleted: result.count };
}
