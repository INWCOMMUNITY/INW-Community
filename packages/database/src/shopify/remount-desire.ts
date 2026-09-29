import type { PrismaClient, ShopifySyncJob } from "@prisma/client";
import { enqueueShopifySyncJob } from "./jobs";

export type ShopifyRemountJobDb = PrismaClient;

export function shopifyRemountListingsDedupeKey(connectionId: string): string {
  return `REMOUNT_LISTINGS:${connectionId}`;
}

/**
 * Enqueue remount of prior-generation NATIVE mappings onto a newly ACTIVE connection
 * for the same member + shop. Idempotent per new connection id.
 */
export async function ensureShopifyRemountListingsJob(
  db: ShopifyRemountJobDb,
  input: {
    connectionId: string;
    memberId: string;
    shopId: string;
  }
): Promise<ShopifySyncJob> {
  return enqueueShopifySyncJob(db, {
    shopifyConnectionId: input.connectionId,
    kind: "REMOUNT_LISTINGS",
    dedupeKey: shopifyRemountListingsDedupeKey(input.connectionId),
    payload: {
      connectionId: input.connectionId,
      memberId: input.memberId,
      shopId: input.shopId,
    },
  });
}
