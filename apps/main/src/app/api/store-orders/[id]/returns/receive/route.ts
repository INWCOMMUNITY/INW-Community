import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { isAwaitingReturnStatus } from "@/lib/store-return";
import { notifyBuyerRefundIssued } from "@/lib/store-return-notify";
import {
  refundArgsFromReturnPolicy,
  refundPaidStorefrontOrder,
} from "@/lib/stripe/refund-store-order";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(_req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      storeReturns: { orderBy: { createdAt: "desc" }, take: 1, include: { returnShipment: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const current = order.storeReturns[0];
  if (!current || !isAwaitingReturnStatus(current.status)) {
    return NextResponse.json(
      { error: "Approve the return before marking it received." },
      { status: 400 }
    );
  }

  const labelCost = current.returnShipment?.labelCostCents ?? current.returnLabelCostCents ?? 0;
  const policy = {
    chargeReturnShipping: current.chargeReturnShipping,
    returnLabelCostCents: labelCost,
  };
  const refundArgs = refundArgsFromReturnPolicy(order, policy);

  const now = new Date();
  await prisma.storeReturn.update({
    where: { id: current.id },
    data: {
      status: "received",
      receivedAt: now,
      returnLabelCostCents: labelCost,
      refundAmountCents: refundArgs.amountCents,
    },
  });

  const result = await refundPaidStorefrontOrder({
    stripe,
    order,
    reason: current.reason ?? "return_received",
    note: current.note,
    ...refundArgs,
    restock: true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await prisma.storeReturn.update({
    where: { id: current.id },
    data: { status: "refunded", refundedAt: new Date(), refundAmountCents: result.amountCents },
  });

  notifyBuyerRefundIssued(order.buyerId, order.id);
  return NextResponse.json({ ok: true, refunded: true, amountCents: result.amountCents });
}
