import { prisma } from "database";

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
    await prisma.storeItem.delete({ where: { id: storeItemId } }).catch(() => {});
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
