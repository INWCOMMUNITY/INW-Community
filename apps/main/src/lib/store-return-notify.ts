import { sendPushNotification } from "@/lib/send-push-notification";
import { formatReturnLabelDeduction } from "@/lib/seller-return-label-policy";

export function notifySellerReturnRequested(
  sellerId: string,
  orderId: string,
  buyerName: string,
  options?: { needsReturnLabel?: boolean }
): void {
  sendPushNotification(sellerId, {
    title: "Refund request",
    body: options?.needsReturnLabel
      ? `${buyerName} requested a refund. Send the return label from your orders page.`
      : `${buyerName} requested a refund. Review it in Refunds & Cancellations.`,
    data: { screen: "seller-returns", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifySellerOrderCanceled(sellerId: string, orderId: string, buyerName: string): void {
  sendPushNotification(sellerId, {
    title: "Order canceled",
    body: `${buyerName} canceled an order. Review it in Refunds & Cancellations.`,
    data: { screen: "seller-returns", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifyBuyerReturnApproved(buyerId: string, orderId: string): void {
  sendPushNotification(buyerId, {
    title: "Return approved",
    body: "Your seller approved the return. Check your order for next steps.",
    data: { screen: "my-orders", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifyBuyerReturnLabelReady(
  buyerId: string,
  orderId: string,
  deductCents?: number | null
): void {
  const deducted =
    typeof deductCents === "number" && deductCents > 0
      ? ` ${formatReturnLabelDeduction(deductCents)} will be deducted from your refund.`
      : "";
  sendPushNotification(buyerId, {
    title: "Your return label arrived",
    body: deducted
      ? `Your return label arrived.${deducted} Print it from your order.`
      : "Your return label arrived. Print it from your order.",
    data: { screen: "my-orders", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifyBuyerReturnDeclined(buyerId: string, orderId: string, reason?: string | null): void {
  sendPushNotification(buyerId, {
    title: "Return declined",
    body: reason?.trim() || "The seller declined your return request.",
    data: { screen: "my-orders", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifyBuyerRefundIssued(buyerId: string, orderId: string): void {
  sendPushNotification(buyerId, {
    title: "Refund Initiated",
    body: "Your refund is on the way. It can take several business days to appear on your statement.",
    data: { screen: "my-orders", orderId },
    category: "commerce",
  }).catch(() => {});
}
