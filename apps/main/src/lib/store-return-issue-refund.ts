import { NextResponse } from "next/server";
import { prisma } from "database";
import { isReturnReceiveRefundRetryable } from "@/lib/store-return";
import { notifyBuyerRefundIssued } from "@/lib/store-return-notify";
import {
  claimStoreReturnReceiptForRefund,
  markStoreReturnRefundedOnce,
} from "@/lib/store-return-receive";
import {
  completeReceivedStoreReturnSettlement,
  type StoreReturnSettlementResult,
} from "@/lib/store-return-settlement";
import { resolveCommerceInventoryWriter } from "@/lib/commerce-foundation-cutover-http";
import { refundPaidStorefrontOrder } from "@/lib/stripe/refund-store-order";
import { createMarketplaceStripe } from "@/lib/stripe-clients";
import { readReturnRefundTiming } from "@/lib/return-refund-timing";
import { LATEST_STORE_RETURN_ORDER_BY } from "@/lib/store-return-order";

export const storeReturnRefundInclude = {
  items: true,
  storeReturns: {
    orderBy: LATEST_STORE_RETURN_ORDER_BY,
    take: 1,
    include: { returnShipment: true },
  },
};

type RefundOrder = {
  id: string;
  sellerId: string;
  buyerId: string;
  status: string;
  totalCents: number;
  subtotalCents: number;
  taxCents?: number | null;
  stripePaymentIntentId: string | null;
  stripeSellerTransferId?: string | null;
  inventoryRestoredAt?: Date | string | null;
  localDeliveryDetails?: unknown;
  items: Array<{
    id?: string;
    storeItemId: string;
    quantity: number;
    variant?: unknown;
    variantId?: string | null;
  }>;
  storeReturns: Array<{
    id: string;
    status: string;
    reason?: string | null;
    note?: string | null;
    chargeReturnShipping: boolean;
    refundAmountCents?: number | null;
    returnLabelCostCents?: number | null;
    returnShipment?: { labelCostCents?: number | null } | null;
  }>;
};

function settlementHttp(result: StoreReturnSettlementResult): NextResponse {
  if (result.kind === "SETTLED" || result.kind === "ALREADY_COMPLETE") {
    return NextResponse.json({ ok: true, refunded: true, amountCents: result.amountCents });
  }
  if (result.kind === "HISTORICALLY_SETTLED") {
    return NextResponse.json({
      ok: true,
      historicallySettled: true,
      refunded: false,
      amountCents: result.amountCents,
    });
  }
  if (result.kind === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED") {
    return NextResponse.json(
      {
        error: result.error,
        historicallySettled: false,
        refunded: false,
        classification: result.classification,
        reasonCodes: result.reasonCodes,
      },
      { status: 409 }
    );
  }
  if (result.kind === "NOT_RECEIVED") {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (result.kind === "INVALID_AMOUNT") {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  if (result.kind === "UNAUTHORIZED_SELLER") {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ error: result.error }, { status: result.httpStatus });
}

export async function executeStoreReturnRefund(args: {
  userId: string;
  writerRoute: "legacy" | "foundation";
  order: RefundOrder;
}): Promise<NextResponse> {
  const { userId, writerRoute, order } = args;
  const current = order.storeReturns[0];
  if (!current) {
    return NextResponse.json(
      { error: "Approve the return before marking it received." },
      { status: 400 }
    );
  }
  if (current.status === "refunded") {
    return NextResponse.json({
      ok: true,
      refunded: true,
      amountCents: current.refundAmountCents ?? 0,
    });
  }
  if (!isReturnReceiveRefundRetryable(current.status)) {
    return NextResponse.json(
      { error: "Approve the return before marking it received." },
      { status: 400 }
    );
  }

  const labelCost = current.returnShipment?.labelCostCents ?? current.returnLabelCostCents ?? 0;
  const claim = await claimStoreReturnReceiptForRefund(prisma, {
    storeOrderId: order.id,
    storeReturnId: current.id,
    order,
    labelCostCents: labelCost,
    chargeReturnShipping: current.chargeReturnShipping,
  });

  if (claim.action === "ineligible") {
    return NextResponse.json(
      { error: "Approve the return before marking it received." },
      { status: 400 }
    );
  }
  if (claim.action === "invalid_amount") {
    return NextResponse.json(
      { error: "Refund amount is invalid; operator reconciliation is required." },
      { status: 409 }
    );
  }
  if (claim.action === "already_complete") {
    return NextResponse.json({ ok: true, refunded: true, amountCents: claim.amountCents });
  }

  const stripe = createMarketplaceStripe();

  if (writerRoute === "foundation") {
    const result = await completeReceivedStoreReturnSettlement({
      stripe,
      storeOrderId: order.id,
      storeReturnId: current.id,
      memberId: userId,
    });
    if (result.kind === "SETTLED" && result.newlyFinalized) {
      notifyBuyerRefundIssued(order.buyerId, order.id);
    }
    return settlementHttp(result);
  }

  if (claim.action === "order_already_refunded") {
    const newlyFinal = await markStoreReturnRefundedOnce(prisma, {
      storeReturnId: current.id,
      amountCents: claim.amountCents,
    });
    if (newlyFinal) notifyBuyerRefundIssued(order.buyerId, order.id);
    return NextResponse.json({ ok: true, refunded: true, amountCents: claim.amountCents });
  }

  const result = await refundPaidStorefrontOrder({
    stripe,
    order,
    reason: current.reason ?? "return_received",
    note: current.note,
    ...claim.refundArgs,
    restock: false,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const newlyFinal = await markStoreReturnRefundedOnce(prisma, {
    storeReturnId: current.id,
    amountCents: result.amountCents,
  });
  if (newlyFinal) notifyBuyerRefundIssued(order.buyerId, order.id);
  return NextResponse.json({ ok: true, refunded: true, amountCents: result.amountCents });
}

/** Tracking said the return was delivered, and the seller chose to refund at that moment. */
export async function refundStoreReturnOnDelivery(orderId: string): Promise<{ refunded: boolean }> {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: storeReturnRefundInclude,
  });
  if (!order) return { refunded: false };
  if (readReturnRefundTiming(order.localDeliveryDetails) !== "on_arrival") return { refunded: false };
  const current = order.storeReturns[0];
  if (!current || current.status === "refunded" || current.status === "declined" || current.status === "canceled") {
    return { refunded: false };
  }
  const writer = await resolveCommerceInventoryWriter();
  if (!writer.ok) return { refunded: false };
  const res = await executeStoreReturnRefund({
    userId: order.sellerId,
    writerRoute: writer.route,
    order,
  });
  return { refunded: res.status < 300 };
}
