import { prisma } from "database";

/**
 * When a store item is marked sold, remove any feed posts that shared that item
 * so the feed does not show "buy this" for sold listings.
 */
export async function deleteFeedPostsForSoldItem(storeItemId: string): Promise<void> {
  await prisma.post.deleteMany({
    where: { sourceStoreItemId: storeItemId },
  });
}
