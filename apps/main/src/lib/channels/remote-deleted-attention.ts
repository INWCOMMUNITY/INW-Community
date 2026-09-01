import { prisma } from "database";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { deleteStoreItemFromChannels } from "./outbound";
import {
  isRemoteDeletedPending,
  persistRemoteDeletedDismissed,
} from "./listing-link-flags";

export { formatRemoteDeletedMessage } from "./remote-deleted-copy";

export async function listRemoteDeletedStoreItemIds(memberId: string): Promise<string[]> {
  const links = await prisma.channelListingLink.findMany({
    where: {
      syncEnabled: true,
      storeItem: { memberId },
      connection: { status: { not: "disconnected" } },
    },
    select: { storeItemId: true, conflictDetails: true },
  });
  const ids = new Set<string>();
  for (const link of links) {
    if (isRemoteDeletedPending(link.conflictDetails)) ids.add(link.storeItemId);
  }
  return [...ids];
}

export async function resolveRemoteDeletedAttention(args: {
  memberId: string;
  storeItemId: string;
  action: "keep" | "delete_everywhere";
}): Promise<{ ok: true; channelSync?: { provider: string; ok: boolean; error?: string }[] } | { ok: false; error: string }> {
  const item = await prisma.storeItem.findFirst({
    where: { id: args.storeItemId, memberId: args.memberId },
    select: {
      id: true,
      title: true,
      priceCents: true,
      memberId: true,
      channelLinks: {
        select: { id: true, conflictDetails: true },
      },
    },
  });
  if (!item) return { ok: false, error: "Item not found." };

  const pending = item.channelLinks.filter((link) => isRemoteDeletedPending(link.conflictDetails));
  if (pending.length === 0) return { ok: false, error: "This item is not waiting on a deleted-shop decision." };

  if (args.action === "keep") {
    for (const link of pending) {
      await persistRemoteDeletedDismissed({ linkId: link.id, conflictDetails: link.conflictDetails });
    }
    return { ok: true };
  }

  let channelSync: { provider: string; ok: boolean; error?: string }[] = [];
  try {
    channelSync = await deleteStoreItemFromChannels(item.id);
  } catch {
    return { ok: false, error: "Could not remove this listing from connected stores. It was not deleted from INW." };
  }
  if (channelSync.some((row) => !row.ok)) {
    return { ok: false, error: "Could not remove this listing from connected stores. It was not deleted from INW." };
  }

  await deleteFeedPostsForSoldItem(item.id).catch(() => {});
  await prisma.storeItem.delete({ where: { id: item.id } });
  const { logSellerActivity } = await import("@/lib/seller-activity-log");
  logSellerActivity(item.memberId, "item_deleted", "store_item", item.id, {
    title: item.title,
    priceCents: item.priceCents,
    reason: "remote_deleted_everywhere",
  });
  return { ok: true, channelSync };
}
