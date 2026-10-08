import type { Prisma, PrismaClient, ShopifySyncJob } from "@prisma/client";
import { reopenShopifySyncJob } from "./jobs";

export type ShopifyPublishJobDb = PrismaClient | Prisma.TransactionClient;

export function shopifyPublishListingDedupeKey(
  connectionId: string,
  storeItemId: string
): string {
  return `PUBLISH_LISTING:${connectionId}:${storeItemId}`;
}

/**
 * Idempotent enqueue for export publication (ACTIVE + Online Store).
 * Used only for seller Sync / CREATE_LISTING mapping — not for imports or
 * unrelated already-mapped listings.
 */
export async function ensureShopifyPublishListingJob(
  db: ShopifyPublishJobDb,
  input: {
    connectionId: string;
    storeItemId: string;
    listingLinkId: string;
  }
): Promise<ShopifySyncJob> {
  return reopenShopifySyncJob(db, {
    shopifyConnectionId: input.connectionId,
    kind: "PUBLISH_LISTING",
    dedupeKey: shopifyPublishListingDedupeKey(input.connectionId, input.storeItemId),
    payload: {
      storeItemId: input.storeItemId,
      listingLinkId: input.listingLinkId,
    },
  });
}
