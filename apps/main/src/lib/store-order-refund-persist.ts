import Stripe from "stripe";
import { prisma } from "database";
import { timestampsFromStripeRefund } from "@/lib/store-order-refund-status";

export async function persistStoreOrderRefundFromStripe(
  orderId: string,
  refund: { id?: string; status?: string | null; created?: number }
): Promise<void> {
  const existing = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    select: { refundInitiatedAt: true, refundCompletedAt: true, stripeRefundId: true },
  });
  if (!existing) return;
  const next = timestampsFromStripeRefund(refund);
  await prisma.storeOrder.update({
    where: { id: orderId },
    data: {
      stripeRefundId: next.stripeRefundId ?? existing.stripeRefundId,
      refundInitiatedAt: existing.refundInitiatedAt ?? next.refundInitiatedAt,
      ...(existing.refundCompletedAt
        ? {}
        : next.refundCompletedAt
          ? { refundCompletedAt: next.refundCompletedAt }
          : {}),
    },
  });
}

export async function syncStoreOrderRefundFromStripe(
  stripe: Stripe,
  order: {
    id: string;
    stripePaymentIntentId?: string | null;
    refundCompletedAt?: Date | string | null;
  }
): Promise<void> {
  if (!order.stripePaymentIntentId || order.refundCompletedAt) return;
  const refunds = await stripe.refunds.list({
    payment_intent: order.stripePaymentIntentId,
    limit: 5,
  });
  const refund = refunds.data[0];
  if (!refund) return;
  await persistStoreOrderRefundFromStripe(order.id, refund);
}
