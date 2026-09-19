import {
  assertLegacyInteractiveMutationAllowed,
  commerceInventoryWriterRoute,
  endFoundationListing,
  getCommerceFoundationCutoverState,
  prisma,
} from "database";
import { storeItemStatusWrite } from "@/lib/store-item-ended-status";

/** Logical End listing: inactive + endedAt. Does not destroy the StoreItem or OrderItems. */
export async function endStoreItemListing(item: { id: string; status: string }) {
  const state = await getCommerceFoundationCutoverState(prisma);
  const route = commerceInventoryWriterRoute(state.mode);
  if (route === "legacy") {
    await assertLegacyInteractiveMutationAllowed(prisma);
    return prisma.storeItem.update({
      where: { id: item.id },
      data: storeItemStatusWrite("inactive", item.status),
    });
  }
  if (route === "foundation") {
    return prisma.$transaction((tx) => endFoundationListing(tx, { storeItemId: item.id, currentStatus: item.status }));
  }
  await assertLegacyInteractiveMutationAllowed(prisma);
}
