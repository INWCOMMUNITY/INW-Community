import type { PrismaClient, StoreReturn } from "database";
import {
  ACTIVE_STORE_RETURN_STATUSES,
  buyerCanRequestRefund,
  isReturnWindowOpen,
} from "@/lib/store-return";
import { pickCurrentOutboundShipment } from "@/lib/store-order-shipments";
import { LATEST_STORE_RETURN_ORDER_BY } from "@/lib/store-return-order";

export type CreateBuyerRequestedStoreReturnInput = {
  orderId: string;
  buyerId: string;
  reason?: string | null;
  note?: string | null;
  now?: Date;
};

export type CreateBuyerRequestedStoreReturnResult =
  | { ok: true; storeReturn: StoreReturn }
  | {
      ok: false;
      error:
        | "not_found"
        | "already_refunded"
        | "already_in_progress"
        | "seller_no_returns"
        | "no_card_payment"
        | "window_ended"
        | "not_eligible";
      storeReturn?: StoreReturn;
    };

/**
 * Authoritative buyer request-refund create path.
 * Locks StoreOrder FOR UPDATE, then re-checks ANY active return, then creates.
 * No network / provider / inventory / ledger work inside the transaction.
 */
export async function createBuyerRequestedStoreReturn(
  prisma: PrismaClient,
  input: CreateBuyerRequestedStoreReturnInput
): Promise<CreateBuyerRequestedStoreReturnResult> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim() || null;
  const note = input.note?.trim() || null;
  const refundReason = [reason, note].filter(Boolean).join(note ? " | Note: " : "") || undefined;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${input.orderId} FOR UPDATE`;

    const order = await tx.storeOrder.findFirst({
      where: { id: input.orderId, buyerId: input.buyerId },
      include: {
        seller: { select: { acceptReturns: true, acceptReturnsDays: true } },
        items: { select: { fulfillmentType: true } },
        shipments: {
          select: { createdAt: true, kind: true, supersededAt: true, trackingStatus: true },
        },
      },
    });
    if (!order) {
      return { ok: false, error: "not_found" } as const;
    }
    if (order.status === "refunded") {
      return { ok: false, error: "already_refunded" } as const;
    }

    // Prefer ANY active return (not merely "latest is active") so zombie duplicates cannot sneak a create.
    const active = await tx.storeReturn.findFirst({
      where: {
        orderId: order.id,
        status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
      },
      orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
    });
    if (active) {
      return { ok: false, error: "already_in_progress", storeReturn: active } as const;
    }

    const latest = await tx.storeReturn.findFirst({
      where: { orderId: order.id },
      orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
    });

    const outbound = pickCurrentOutboundShipment(order.shipments);
    const refundCheck = {
      status: order.status,
      isCashOrder: !order.stripePaymentIntentId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      sellerAcceptsReturns: order.seller.acceptReturns,
      sellerAcceptsReturnsDays: order.seller.acceptReturnsDays,
      storeReturn: latest,
      refundRequestedAt: latest ? null : order.refundRequestedAt,
      createdAt: order.createdAt,
      items: order.items,
      pickupSellerConfirmedAt: order.pickupSellerConfirmedAt,
      pickupBuyerConfirmedAt: order.pickupBuyerConfirmedAt,
      deliveryConfirmedAt: order.deliveryConfirmedAt,
      deliveryBuyerConfirmedAt: order.deliveryBuyerConfirmedAt,
      shipment: outbound,
    };

    if (!buyerCanRequestRefund(refundCheck, now)) {
      if (order.seller.acceptReturns === false) {
        return { ok: false, error: "seller_no_returns" } as const;
      }
      if (!order.stripePaymentIntentId) {
        return { ok: false, error: "no_card_payment" } as const;
      }
      if (!isReturnWindowOpen(refundCheck, order.seller.acceptReturnsDays, now)) {
        return { ok: false, error: "window_ended" } as const;
      }
      return { ok: false, error: "not_eligible" } as const;
    }

    const created = await tx.storeReturn.create({
      data: {
        orderId: order.id,
        status: "requested",
        reason: refundReason ?? reason,
        note,
        requestedAt: now,
      },
    });
    await tx.storeOrder.update({
      where: { id: order.id },
      data: { refundRequestedAt: now, refundReason: refundReason || undefined },
    });
    return { ok: true, storeReturn: created } as const;
  });
}
