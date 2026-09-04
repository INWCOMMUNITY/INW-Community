import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { getSessionForApi } from "@/lib/mobile-auth";
import { isActiveStoreReturnStatus } from "@/lib/store-return";
import { notifyBuyerRefundIssued } from "@/lib/store-return-notify";
import { refundPaidStorefrontOrder } from "@/lib/stripe/refund-store-order";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-11-20.acacia" as "2023-10-16",
});

export const dynamic = "force-dynamic";

/** Courtesy refund: money back now, buyer keeps the item (no restock). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
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

  let body: { requireReturn?: boolean; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body = courtesy refund
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: { items: true, storeReturns: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (body.requireReturn === true) {
    return NextResponse.json(
      { error: "Approve the return, then mark it received to refund after the item comes back." },
      { status: 400 }
    );
  }

  const current = order.storeReturns[0];
  if (current && isActiveStoreReturnStatus(current.status) && current.status !== "requested") {
    return NextResponse.json(
      { error: "This return is waiting for the item. Mark it received to refund, or keep waiting." },
      { status: 400 }
    );
  }

  const result = await refundPaidStorefrontOrder({
    stripe,
    order,
    reason: "requested_by_seller",
    note: typeof body.note === "string" ? body.note : null,
    restock: false,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (current && isActiveStoreReturnStatus(current.status)) {
    await prisma.storeReturn.update({
      where: { id: current.id },
      data: {
        status: "refunded",
        requireReturn: false,
        refundedAt: new Date(),
        refundAmountCents: result.amountCents,
      },
    });
  } else {
    await prisma.storeReturn.create({
      data: {
        orderId: order.id,
        status: "refunded",
        requireReturn: false,
        reason: "Courtesy refund",
        refundedAt: new Date(),
        refundAmountCents: result.amountCents,
      },
    });
  }

  notifyBuyerRefundIssued(order.buyerId, order.id);
  return NextResponse.json({ ok: true, amountCents: result.amountCents });
}
