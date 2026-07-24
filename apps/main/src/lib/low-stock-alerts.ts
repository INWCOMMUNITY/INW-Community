/**
 * Low Stock Alerts
 * Detects when inventory falls below threshold and triggers notifications.
 */

import { prisma } from "database";
import { sendPushNotification } from "./send-push-notification";
import { logSellerActivity } from "./seller-activity-log";

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

interface StoreItemForLowStock {
  id: string;
  memberId: string;
  title: string;
  quantity: number;
  lowStockThreshold: number | null;
}

/**
 * Check if an item's quantity has fallen to or below its low stock threshold.
 * Sends a push notification and logs activity if it triggers for the first time.
 * 
 * Call this after inventory changes (sales, manual updates, bulk edits).
 */
export async function checkLowStock(
  item: StoreItemForLowStock,
  previousQuantity?: number
): Promise<{ triggered: boolean; threshold: number }> {
  const threshold = item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const currentQty = item.quantity;

  // Don't alert if already at or below threshold before the change
  if (previousQuantity !== undefined && previousQuantity <= threshold) {
    return { triggered: false, threshold };
  }

  // Check if we've now fallen to or below threshold
  if (currentQty > threshold) {
    return { triggered: false, threshold };
  }

  // Trigger low stock alert
  await triggerLowStockAlert(item, threshold);

  return { triggered: true, threshold };
}

/**
 * Check low stock for a store item by ID.
 * Useful when you only have the ID and need to fetch the item data.
 */
export async function checkLowStockById(
  storeItemId: string,
  previousQuantity?: number
): Promise<{ triggered: boolean; threshold: number } | null> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      id: true,
      memberId: true,
      title: true,
      quantity: true,
      lowStockThreshold: true,
    },
  });

  if (!item) {
    return null;
  }

  return checkLowStock(item, previousQuantity);
}

/**
 * Trigger a low stock alert: log activity and send push notification.
 */
async function triggerLowStockAlert(
  item: StoreItemForLowStock,
  threshold: number
): Promise<void> {
  // Log the activity
  logSellerActivity(item.memberId, "low_stock_alert", "store_item", item.id, {
    title: item.title,
    quantity: item.quantity,
    threshold,
  });

  // Send push notification
  const title = "Low Stock Alert";
  const body = `"${truncateTitle(item.title)}" has only ${item.quantity} left in stock.`;

  await sendPushNotification(item.memberId, {
    title,
    body,
    data: {
      screen: "seller-hub/store/items",
      storeItemId: item.id,
    },
    category: "seller_ops",
  });
}

/**
 * Batch check low stock for multiple items.
 * Returns items that triggered alerts.
 */
export async function checkLowStockBatch(
  items: Array<{ id: string; previousQuantity?: number }>
): Promise<string[]> {
  const triggeredIds: string[] = [];

  // Fetch all items in one query
  const storeItems = await prisma.storeItem.findMany({
    where: { id: { in: items.map((i) => i.id) } },
    select: {
      id: true,
      memberId: true,
      title: true,
      quantity: true,
      lowStockThreshold: true,
    },
  });

  const itemMap = new Map(storeItems.map((i) => [i.id, i]));

  for (const { id, previousQuantity } of items) {
    const item = itemMap.get(id);
    if (!item) continue;

    const result = await checkLowStock(item, previousQuantity);
    if (result.triggered) {
      triggeredIds.push(id);
    }
  }

  return triggeredIds;
}

/**
 * Get items that are currently at or below their low stock threshold.
 */
export async function getLowStockItems(memberId: string): Promise<
  Array<{
    id: string;
    title: string;
    quantity: number;
    threshold: number;
  }>
> {
  // We can't directly compare quantity to lowStockThreshold in Prisma,
  // so fetch all active items and filter in memory
  const items = await prisma.storeItem.findMany({
    where: {
      memberId,
      status: "active",
      quantity: { gt: 0 },
    },
    select: {
      id: true,
      title: true,
      quantity: true,
      lowStockThreshold: true,
    },
  });

  return items
    .filter((item) => {
      const threshold = item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      return item.quantity <= threshold;
    })
    .map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      threshold: item.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
    }));
}

/**
 * Truncate title for notification display.
 */
function truncateTitle(title: string, maxLength = 30): string {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength - 3) + "...";
}
