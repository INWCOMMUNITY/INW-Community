import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { ACTIVE_STORE_RETURN_STATUSES, isActiveStoreReturnStatus } from "@/lib/store-return";
import { LATEST_STORE_RETURN_ORDER_BY } from "@/lib/store-return-order";
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
      storeReturns: { orderBy: [...LATEST_STORE_RETURN_ORDER_BY], take: 1 },
      seller: { select: { chargeReturnShipping: true } },
      items: { select: { fulfillmentType: true } },
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
        // StoreOrder first — same lock order as request-refund / receive / Unit 2–4.
        await tx.$executeRaw`SELECT 1 FROM "StoreOrder" WHERE "id" = ${order.id} FOR UPDATE`;
        const active = await tx.storeReturn.findFirst({
          where: {
            orderId: order.id,
            status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
          },
          orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
        });
        if (active) {
          if (active.status === "requested") {
            return tx.storeReturn.update({
              where: { id: active.id },
              data: {
                status: "awaiting_return",
                requireReturn: true,
                chargeReturnShipping: order.seller.chargeReturnShipping,
                approvedAt: now,
              },
            });
          }
          return active;
        }
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

  const canBuyReturnLabel = order.items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  if (!canBuyReturnLabel) {
    notifyBuyerReturnApproved(order.buyerId, order.id);
  }
  return NextResponse.json({ ok: true, storeReturn: updated, canBuyReturnLabel });
}
