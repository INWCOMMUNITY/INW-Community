import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { isActiveStoreReturnStatus } from "@/lib/store-return";
import { notifyBuyerReturnApproved } from "@/lib/store-return-notify";

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
      storeReturns: { orderBy: { createdAt: "desc" }, take: 1 },
      seller: { select: { chargeReturnShipping: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const current = order.storeReturns[0];
  if (current && isActiveStoreReturnStatus(current.status) && current.status !== "requested") {
    return NextResponse.json({ ok: true, storeReturn: current });
  }
  if (order.status !== "shipped" && order.status !== "delivered" && order.status !== "paid") {
    return NextResponse.json({ error: "This order cannot be returned" }, { status: 400 });
  }

  const now = new Date();
  const updated = current
    ? await prisma.storeReturn.update({
        where: { id: current.id },
        data: {
          status: "awaiting_return",
          requireReturn: true,
          chargeReturnShipping: order.seller.chargeReturnShipping,
          approvedAt: now,
        },
      })
    : await prisma.$transaction(async (tx) => {
        const created = await tx.storeReturn.create({
          data: {
            orderId: order.id,
            status: "awaiting_return",
            requireReturn: true,
            chargeReturnShipping: order.seller.chargeReturnShipping,
            reason: "Initiated by seller",
            requestedAt: now,
            approvedAt: now,
          },
        });
        await tx.storeOrder.update({
          where: { id: order.id },
          data: { refundRequestedAt: now, refundReason: "Initiated by seller" },
        });
        return created;
      });

  notifyBuyerReturnApproved(order.buyerId, order.id);
  return NextResponse.json({ ok: true, storeReturn: updated });
}
