import { prisma } from "database";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { inactiveStoreItemData } from "@/lib/store-item-ended-status";

/** Prisma filter: only live INW imports. Disabled links are leftover from unsyncing INW. */
export function importedChannelLinkWhere(connectionId: string, provider: string) {
  return {
    provider,
    connectionId,
    syncEnabled: true,
  };
}

/**
 * Manage Listings "uncheck INW" disables leftover shop links and ends the storefront item.
 * Those rows must not keep blocking Sync Stores → Import Listings.
 */
export function unsyncedInwLinkShouldBeForgotten(args: {
  storeItemStatus: string | null | undefined;
  syncEnabled: boolean;
}): boolean {
  return args.storeItemStatus === "inactive" && args.syncEnabled === false;
}

/** Drop channel links and the INW record so the remote listing can be imported again. */
export async function forgetImportedStoreItemFromInw(storeItemId: string): Promise<void> {
  await prisma.channelListingLink.deleteMany({ where: { storeItemId } });
  await deleteFeedPostsForSoldItem(storeItemId).catch(() => {});
  try {
    await prisma.storeItem.delete({ where: { id: storeItemId } });
  } catch {
    await prisma.storeItem
      .update({
        where: { id: storeItemId },
        data: inactiveStoreItemData(),
      })
      .catch(() => {});
  }
}

/**
 * Remove the channel link for a listing. Optionally delete the StoreItem from INW.
 * Does not delete the listing on the external marketplace.
 */
export async function unsyncChannelListingByExternalId(args: {
  userId: string;
  provider: string;
  externalListingId: string;
  removeFromINW: boolean;
}): Promise<
  | { ok: true; message: string; removed: boolean; storeItemId: string }
  | { ok: false; status: number; error: string }
> {
  const { userId, provider, externalListingId, removeFromINW } = args;

  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider,
      externalListingId,
    },
    include: {
      storeItem: { select: { id: true, memberId: true, title: true } },
      connection: { select: { memberId: true } },
    },
  });

  if (!link) {
    return {
      ok: false,
      status: 404,
      error: "Listing not found or not linked to your account.",
    };
  }

  const ownerId = link.storeItem?.memberId ?? link.connection.memberId;
  if (ownerId !== userId) {
    return { ok: false, status: 403, error: "You don't have permission to unsync this listing." };
  }

  const itemTitle = link.storeItem?.title ?? externalListingId;
  const storeItemId = link.storeItemId;

  await prisma.channelListingLink.delete({ where: { id: link.id } });

  if (removeFromINW && storeItemId) {
    await forgetImportedStoreItemFromInw(storeItemId);
    return {
      ok: true,
      message: `Removed "${itemTitle}" from INW and unsynced from ${provider}.`,
      removed: true,
      storeItemId,
    };
  }

  return {
    ok: true,
    message: `Unsynced "${itemTitle}" from ${provider}. Item kept in INW.`,
    removed: false,
    storeItemId,
  };
}
