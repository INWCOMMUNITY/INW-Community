import { prisma } from "database";
import { storeItemStatusWrite } from "@/lib/store-item-ended-status";

/** Logical End listing: inactive + endedAt. Does not destroy the StoreItem or OrderItems. */
export async function endStoreItemListing(item: { id: string; status: string }) {
  return prisma.storeItem.update({
    where: { id: item.id },
    data: storeItemStatusWrite("inactive", item.status),
  });
}
