import { prisma } from "database";
import { getAvailableQuantity } from "@/lib/store-item-variants";

/** Cancel other buyers' pending checkout orders that include sold-out items; notify once per buyer+item. */
export async function cancelPendingOrdersForSoldOutItems(params: {
  soldOutStoreItemIds: string[];
  excludeBuyerId: string;
  titleByItemId: Map<string, string>;
}): Promise<void> {
  const { soldOutStoreItemIds, excludeBuyerId, titleByItemId } = params;
  if (soldOutStoreItemIds.length === 0) return;

  const otherPendingOrderItems = await prisma.orderItem.findMany({
    where: {
      storeItemId: { in: soldOutStoreItemIds },
      order: { status: "pending", buyerId: { not: excludeBuyerId } },
    },
    include: { order: { select: { id: true, buyerId: true } } },
  });
  const ordersToCancel = new Set<string>();
  const notifiedBuyerItems = new Set<string>();
  const { sendPushNotification } = await import("@/lib/send-push-notification");

  for (const oi of otherPendingOrderItems) {
    if (!oi.order) continue;
    ordersToCancel.add(oi.order.id);
    const key = `${oi.order.buyerId}:${oi.storeItemId}`;
    if (notifiedBuyerItems.has(key)) continue;
    notifiedBuyerItems.add(key);
    const title = titleByItemId.get(oi.storeItemId) ?? "Item";
    sendPushNotification(oi.order.buyerId, {
      title: "Item no longer available",
      body: `This item sold before checkout was complete: ${title}`,
      data: { screen: "cart" },
    }).catch(() => {});
  }
  if (ordersToCancel.size > 0) {
    await prisma.storeOrder.updateMany({
      where: { id: { in: [...ordersToCancel] } },
      data: {
        status: "canceled",
        cancelReason: "Item sold before checkout was complete",
      },
    });
  }
}

/**
 * After a successful purchase, sync other users' carts to remaining inventory.
 * Removes lines with zero availability; clamps quantity when partially available.
 */
export async function cleanupOtherBuyersCartsForStoreItems(params: {
  winningBuyerId: string;
  purchasedStoreItemIds: string[];
}): Promise<void> {
  const ids = [...new Set(params.purchasedStoreItemIds)];
  if (ids.length === 0) return;

  const storeItems = await prisma.storeItem.findMany({
    where: { id: { in: ids } },
  });
  const map = new Map(storeItems.map((s) => [s.id, s]));

  const cartRows = await prisma.cartItem.findMany({
    where: {
      storeItemId: { in: ids },
      memberId: { not: params.winningBuyerId },
    },
  });
  if (cartRows.length === 0) return;

  const { sendPushNotification } = await import("@/lib/send-push-notification");
  const notifiedRemoved = new Set<string>();

  for (const row of cartRows) {
    const si = map.get(row.storeItemId);
    if (!si) {
      await prisma.cartItem.delete({ where: { id: row.id } });
      continue;
    }
    const avail = getAvailableQuantity(si, row.variant ?? undefined);
    if (avail <= 0) {
      await prisma.cartItem.delete({ where: { id: row.id } });
      const key = `${row.memberId}:${row.storeItemId}`;
      if (!notifiedRemoved.has(key)) {
        notifiedRemoved.add(key);
        sendPushNotification(row.memberId, {
          title: "Item sold",
          body: `${si.title} was purchased by another member and was removed from your cart.`,
          data: { screen: "cart" },
        }).catch(() => {});
      }
    } else if (row.quantity > avail) {
      await prisma.cartItem.update({
        where: { id: row.id },
        data: { quantity: avail },
      });
    }
  }
}

function variantKey(variant: unknown): string {
  try {
    return JSON.stringify(variant ?? null);
  } catch {
    return "null";
  }
}

/** Returns error message if any line in the order batch cannot be fulfilled at current inventory. */
export function validateBatchStoreOrdersInventory(
  orders: Array<{ items: Array<{ storeItemId: string; quantity: number; variant: unknown }> }>,
  storeItemMap: Map<string, { title: string; variants: unknown; quantity: number }>
): { ok: true } | { ok: false; titles: string[] } {
  const merged = new Map<string, { storeItemId: string; variant: unknown; quantity: number }>();
  for (const order of orders) {
    for (const oi of order.items) {
      const key = `${oi.storeItemId}::${variantKey(oi.variant)}`;
      const prev = merged.get(key);
      merged.set(key, {
        storeItemId: oi.storeItemId,
        variant: oi.variant,
        quantity: (prev?.quantity ?? 0) + oi.quantity,
      });
    }
  }
  const titles: string[] = [];
  for (const { storeItemId, variant, quantity } of merged.values()) {
    const si = storeItemMap.get(storeItemId);
    const available = si ? getAvailableQuantity(si, variant) : 0;
    if (available < quantity) {
      titles.push(si?.title ?? "Item");
    }
  }
  if (titles.length > 0) return { ok: false, titles };
  return { ok: true };
}
