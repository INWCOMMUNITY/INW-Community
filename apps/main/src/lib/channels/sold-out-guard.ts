import { prisma } from "database";

/** Same window as sales reconciliation — recent sales must beat catalog qty recovery. */
export const SALE_QTY_RECOVERY_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 2;

/**
 * True when INW should not pull a positive remote quantity onto a sold-out item:
 * a sale (or GetItem sale ack) landed recently. Failed zero-pushes must not block
 * restock — that made false sold-outs stick when eBay/Etsy still had the item.
 */
export async function shouldBlockSoldOutQtyRecovery(storeItemId: string): Promise<boolean> {
  const since = new Date(Date.now() - SALE_QTY_RECOVERY_LOOKBACK_MS);
  const sale = await prisma.channelSyncEvent.findFirst({
    where: {
      storeItemId,
      type: { in: ["sale", "sale_ack_absolute"] },
      processedAt: { gte: since },
    },
    select: { id: true },
  });
  return Boolean(sale);
}

/** Recovery = remote still has stock while INW is at 0 / sold_out. */
export function isSoldOutQtyRecovery(
  inwQuantity: number,
  inwStatus: string,
  remoteQuantity: number
): boolean {
  return remoteQuantity > 0 && (inwQuantity === 0 || inwStatus === "sold_out");
}

/**
 * After a sale, storeItemContentHash changes (it includes qty/status) so cron would
 * run a full content updateListing. That path verifies Etsy qty 0 and eBay bulk-qty 0,
 * both of which fail. Keep sell-out on updateInventory unless title/photos/price drifted.
 */
export function shouldPushSoldOutInventoryOnly(args: {
  quantity: number;
  status: string;
  contentUnchanged: boolean;
  inventoryDrift: boolean;
  syncBaselineHash: string | null | undefined;
  contentHashNow: string;
}): boolean {
  if (args.contentUnchanged && args.inventoryDrift) return true;
  const soldOut = args.status === "sold_out" || args.quantity <= 0;
  if (!soldOut || args.contentUnchanged) return false;
  if (!args.syncBaselineHash) return true;
  return args.syncBaselineHash === args.contentHashNow;
}
