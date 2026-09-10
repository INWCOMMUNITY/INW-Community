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
 * Decide when a channel push should be inventory-only (updateInventory) rather than a full
 * content re-list (updateListing / eBay passthrough / Etsy verify).
 *
 * Root cause: `lastPushedHash` (storeItemContentHash) includes qty + status, so ANY quantity
 * change — a sale, a restock, a sold-out — makes the full hash mismatch and cron would run a
 * full content push on every tick (extra load, 429s, revert risk). But the CONTENT baseline
 * (`syncBaselineHash` = syncContentHash: title/description/price/photos only) hasn't moved.
 *
 * So: when INW content still equals the agreed baseline, there is nothing to content-push — any
 * difference is qty/status, so push inventory only. Only fall through to a full content push when
 * the content genuinely drifted from the baseline.
 */
export function shouldPushInventoryOnly(args: {
  quantity: number;
  status: string;
  contentUnchanged: boolean;
  inventoryDrift: boolean;
  syncBaselineHash: string | null | undefined;
  contentHashNow: string;
}): boolean {
  if (args.contentUnchanged && args.inventoryDrift) return true;
  // Content matches the agreed baseline -> qty/status-only change -> inventory-only, whether or
  // not the item is sold out. This is the fix for the "full push after every qty change" loop.
  if (args.syncBaselineHash && args.syncBaselineHash === args.contentHashNow) return true;
  const soldOut = args.status === "sold_out" || args.quantity <= 0;
  if (!soldOut || args.contentUnchanged) return false;
  // Sold-out with no baseline yet: push inventory to take the listing down rather than re-list.
  return !args.syncBaselineHash;
}

/** @deprecated Use {@link shouldPushInventoryOnly}. Kept as an alias during the rename. */
export const shouldPushSoldOutInventoryOnly = shouldPushInventoryOnly;
