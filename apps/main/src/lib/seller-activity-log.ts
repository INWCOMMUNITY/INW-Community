/**
 * Seller Activity Log
 * Logs seller activities for audit trail and timeline display.
 */

import { prisma, Prisma } from "database";

export type SellerActivityAction =
  | "item_created"
  | "item_updated"
  | "item_deleted"
  | "bulk_edit"
  | "bulk_publish"
  | "bulk_unpublish"
  | "bulk_delete"
  | "bulk_relist"
  | "channel_linked"
  | "channel_unlinked"
  | "order_received"
  | "offer_received"
  | "offer_accepted"
  | "offer_declined"
  | "payout_requested"
  | "low_stock_alert"
  | "sync_error"
  | "template_created"
  | "template_updated"
  | "template_deleted";

export type EntityType =
  | "store_item"
  | "channel_link"
  | "order"
  | "payout"
  | "offer"
  | "template"
  | "bulk_operation";

export interface ActivityDetail {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  itemIds?: string[];
  itemTitles?: string[];
  provider?: string;
  channelName?: string;
  orderNumber?: string;
  totalCents?: number;
  offerAmountCents?: number;
  quantity?: number;
  threshold?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface ActivityMetadata {
  source?: "web" | "mobile" | "api" | "cron";
  userAgent?: string;
  ipAddress?: string;
  [key: string]: unknown;
}

/**
 * Log a seller activity event.
 * Fire-and-forget: never throws, only logs errors.
 */
export function logSellerActivity(
  memberId: string,
  action: SellerActivityAction,
  entityType: EntityType,
  entityId?: string | null,
  detail?: ActivityDetail | null,
  metadata?: ActivityMetadata | null
): void {
  prisma.sellerActivityLog
    .create({
      data: {
        memberId,
        action,
        entityType,
        entityId: entityId ?? null,
        detail: detail != null ? (detail as Prisma.InputJsonValue) : undefined,
        metadata: metadata != null ? (metadata as Prisma.InputJsonValue) : undefined,
      },
    })
    .catch((e) => {
      console.error("[seller-activity-log] Failed to log activity:", e);
    });
}

/**
 * Create a detail object for item updates, showing before/after changes.
 */
export function createUpdateDetail(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldsToTrack: string[]
): ActivityDetail | null {
  const changes: { field: string; before: unknown; after: unknown }[] = [];

  for (const field of fieldsToTrack) {
    const beforeVal = before[field];
    const afterVal = after[field];

    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes.push({ field, before: beforeVal, after: afterVal });
    }
  }

  if (changes.length === 0) {
    return null;
  }

  return {
    changes,
    changedFields: changes.map((c) => c.field),
  };
}

/**
 * Format activity for display.
 */
export function formatActivityMessage(
  action: SellerActivityAction,
  detail?: ActivityDetail | null
): string {
  switch (action) {
    case "item_created":
      return "Created a new listing";
    case "item_updated":
      const changedFields = (detail?.changedFields as string[]) ?? [];
      if (changedFields.length > 0) {
        return `Updated listing: ${changedFields.slice(0, 3).join(", ")}${changedFields.length > 3 ? "..." : ""}`;
      }
      return "Updated listing";
    case "item_deleted":
      return "Deleted listing";
    case "bulk_edit":
      const editCount = (detail?.itemIds as string[])?.length ?? 0;
      return `Bulk edited ${editCount} item${editCount !== 1 ? "s" : ""}`;
    case "bulk_publish":
      const pubCount = (detail?.itemIds as string[])?.length ?? 0;
      return `Published ${pubCount} item${pubCount !== 1 ? "s" : ""} to ${detail?.provider ?? "channels"}`;
    case "bulk_unpublish":
      const unpubCount = (detail?.itemIds as string[])?.length ?? 0;
      return `Unpublished ${unpubCount} item${unpubCount !== 1 ? "s" : ""} from ${detail?.provider ?? "channels"}`;
    case "bulk_delete":
      const delCount = (detail?.itemIds as string[])?.length ?? 0;
      return `Deleted ${delCount} item${delCount !== 1 ? "s" : ""}`;
    case "channel_linked":
      return `Connected to ${detail?.channelName ?? detail?.provider ?? "channel"}`;
    case "channel_unlinked":
      return `Disconnected from ${detail?.channelName ?? detail?.provider ?? "channel"}`;
    case "order_received":
      const orderTotal = detail?.totalCents ? `$${((detail.totalCents as number) / 100).toFixed(2)}` : "";
      return `New order received${orderTotal ? ` - ${orderTotal}` : ""}`;
    case "offer_received":
      const offerAmount = detail?.offerAmountCents ? `$${((detail.offerAmountCents as number) / 100).toFixed(2)}` : "";
      return `Received offer${offerAmount ? ` for ${offerAmount}` : ""}`;
    case "offer_accepted":
      return "Accepted an offer";
    case "offer_declined":
      return "Declined an offer";
    case "payout_requested":
      return "Requested payout";
    case "low_stock_alert":
      const qty = detail?.quantity ?? 0;
      const threshold = detail?.threshold ?? 5;
      return `Low stock alert: ${qty} remaining (threshold: ${threshold})`;
    case "sync_error":
      return `Sync error: ${detail?.errorMessage ?? "Unknown error"}`;
    case "template_created":
      return "Created listing template";
    case "template_updated":
      return "Updated listing template";
    case "template_deleted":
      return "Deleted listing template";
    default:
      return action.replace(/_/g, " ");
  }
}

/**
 * Get icon name for activity action (Ionicons).
 */
export function getActivityIcon(action: SellerActivityAction): string {
  switch (action) {
    case "item_created":
      return "add-circle-outline";
    case "item_updated":
      return "create-outline";
    case "item_deleted":
      return "trash-outline";
    case "bulk_edit":
    case "bulk_publish":
    case "bulk_unpublish":
    case "bulk_delete":
      return "layers-outline";
    case "channel_linked":
      return "link-outline";
    case "channel_unlinked":
      return "unlink-outline";
    case "order_received":
      return "bag-check-outline";
    case "offer_received":
    case "offer_accepted":
    case "offer_declined":
      return "chatbubble-outline";
    case "payout_requested":
      return "cash-outline";
    case "low_stock_alert":
      return "alert-circle-outline";
    case "sync_error":
      return "warning-outline";
    case "template_created":
    case "template_updated":
    case "template_deleted":
      return "document-outline";
    default:
      return "ellipsis-horizontal-outline";
  }
}

/**
 * Get color for activity action.
 */
export function getActivityColor(action: SellerActivityAction): string {
  switch (action) {
    case "item_created":
    case "channel_linked":
    case "offer_accepted":
      return "#22c55e"; // green
    case "item_updated":
    case "bulk_edit":
    case "template_updated":
      return "#3b82f6"; // blue
    case "item_deleted":
    case "bulk_delete":
    case "channel_unlinked":
    case "offer_declined":
    case "template_deleted":
      return "#ef4444"; // red
    case "order_received":
    case "payout_requested":
      return "#8b5cf6"; // purple
    case "low_stock_alert":
    case "sync_error":
      return "#f59e0b"; // amber
    default:
      return "#6b7280"; // gray
  }
}
