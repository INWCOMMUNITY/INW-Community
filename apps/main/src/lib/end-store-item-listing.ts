import {
  assertLegacyInteractiveMutationAllowed,
  commerceInventoryWriterRoute,
  endFoundationListing,
  getCommerceFoundationCutoverState,
  prisma,
} from "database";
import { disconnectStoreItemChannels } from "@/lib/disconnect-ended-listing-channels";
import { storeItemStatusWrite } from "@/lib/store-item-ended-status";

/** Logical End listing: inactive + endedAt. Does not destroy the StoreItem or OrderItems. */
export async function endStoreItemListing(item: { id: string; status: string }) {
  const state = await getCommerceFoundationCutoverState(prisma);
  const route = commerceInventoryWriterRoute(state.mode);
  if (route === "legacy") {
    await assertLegacyInteractiveMutationAllowed(prisma);
    const updated = await prisma.storeItem.update({
      where: { id: item.id },
      data: storeItemStatusWrite("inactive", item.status),
    });
    await disconnectStoreItemChannels(item.id);
    return updated;
  }
  if (route === "foundation") {
    const updated = await prisma.$transaction((tx) =>
      endFoundationListing(tx, { storeItemId: item.id, currentStatus: item.status })
    );
    await disconnectStoreItemChannels(item.id);
    return updated;
  }
  await assertLegacyInteractiveMutationAllowed(prisma);
}
