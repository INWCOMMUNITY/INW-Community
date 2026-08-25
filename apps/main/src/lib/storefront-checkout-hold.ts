import { prisma } from "database";

const PENDING_HOLD_MS = 25 * 60 * 1000;
const CANCEL_OWN_PENDING_OLDER_THAN_MS = 60 * 1000;

/** Cancel leftover pending checkouts for this buyer so a new checkout can take the last unit. */
export async function cancelStaleBuyerPendingOrders(buyerId: string): Promise<void> {
  const cancelPendingOlderThan = new Date(Date.now() - CANCEL_OWN_PENDING_OLDER_THAN_MS);
  await prisma.storeOrder.updateMany({
    where: {
      buyerId,
      status: "pending",
      createdAt: { lt: cancelPendingOlderThan },
    },
    data: { status: "canceled" },
  });
}

/**
 * Qty=1 (or last-unit) hold: another buyer's recent pending checkout owns the unit.
 */
export async function conflictingQty1PendingHold(args: {
  storeItemIds: string[];
  buyerId: string;
}): Promise<{ storeItemId: string } | null> {
  if (args.storeItemIds.length === 0) return null;
  const pendingCutoff = new Date(Date.now() - PENDING_HOLD_MS);
  const otherPending = await prisma.orderItem.findFirst({
    where: {
      storeItemId: { in: args.storeItemIds },
      order: {
        status: "pending",
        buyerId: { not: args.buyerId },
        createdAt: { gte: pendingCutoff },
      },
    },
    select: { storeItemId: true },
  });
  return otherPending ? { storeItemId: otherPending.storeItemId } : null;
}
