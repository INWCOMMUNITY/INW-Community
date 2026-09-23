import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

function settlementHttp(result: StoreReturnSettlementResult): NextResponse {
  if (result.kind === "SETTLED" || result.kind === "ALREADY_COMPLETE") {
    return NextResponse.json({ ok: true, refunded: true, amountCents: result.amountCents });
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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(_req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const writer = await resolveCommerceInventoryWriter();
  if (!writer.ok) return writer.response;

  const sub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(userId),
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: {
      items: true,
      storeReturns: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: { returnShipment: true },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
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

  if (writer.route === "foundation") {
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
    restock: true,
    restockOperationId: current.id,
    restockKind: "PHYSICAL_RECEIPT",
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
