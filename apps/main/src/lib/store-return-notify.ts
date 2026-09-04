import { sendPushNotification } from "@/lib/send-push-notification";

export function notifySellerReturnRequested(sellerId: string, orderId: string, buyerName: string): void {
  sendPushNotification(sellerId, {
    title: "Return requested",
    body: `${buyerName} requested a return. Review it in Return Requests.`,
    data: { screen: "seller-returns", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifyBuyerReturnApproved(buyerId: string, orderId: string): void {
  sendPushNotification(buyerId, {
    title: "Return approved",
    body: "Your seller approved the return. Check your order for the return label and next steps.",
    data: { screen: "my-orders", orderId },
    category: "commerce",
  }).catch(() => {});
}

export function notifyBuyerReturnLabelReady(buyerId: string, orderId: string): void {
  sendPushNotification(buyerId, {
    title: "Return shipping label ready",
    body: "Your return label is on the order page. Print it and send the item back.",
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
    title: "Refund issued",
    body: "Your refund is on the way. It can take a few days to appear on your statement.",
    data: { screen: "my-orders", orderId },
    category: "commerce",
  }).catch(() => {});
}
