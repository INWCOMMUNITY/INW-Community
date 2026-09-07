import {
  storeOrderRefundStatusLabel,
  type StoreOrderRefundFields,
} from "@/lib/store-order-refund-status";

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
  refunded: "Refund initiated",
};

export function getOrderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export function getStoreOrderStatusLabel(order: StoreOrderRefundFields): string {
  return storeOrderRefundStatusLabel(order) ?? getOrderStatusLabel(order.status);
}
