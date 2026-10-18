import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { LATEST_STORE_RETURN_ORDER_BY } from "@/lib/store-return-order";
import { isAwaitingReturnStatus } from "@/lib/store-return";
import { withReturnRefundTiming, type ReturnRefundTiming } from "@/lib/return-refund-timing";

export const dynamic = "force-dynamic";

/** Seller chooses Refund Now or Refund when the return is delivered. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const body = (await req.json().catch(() => ({}))) as { timing?: string };
  const timing: ReturnRefundTiming | null =
    body.timing === "now" || body.timing === "on_arrival" ? body.timing : null;
  if (!timing) {
    return NextResponse.json({ error: "Choose when to refund." }, { status: 400 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: {
      storeReturns: {
        orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
        take: 1,
        include: { returnShipment: true },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const current = order.storeReturns[0];
  if (!current || !isAwaitingReturnStatus(current.status)) {
    return NextResponse.json({ error: "This return is no longer waiting on a label." }, { status: 400 });
  }
  if (!current.returnShipmentId && !current.returnShipment?.labelUrl) {
    return NextResponse.json({ error: "Send the return label before choosing a refund time." }, { status: 400 });
  }

  await prisma.storeOrder.update({
    where: { id: order.id },
    data: {
      localDeliveryDetails: withReturnRefundTiming(
        order.localDeliveryDetails,
        timing
      ) as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true, timing });
}
