import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { LATEST_STORE_RETURN_ORDER_BY } from "@/lib/store-return-order";

export const dynamic = "force-dynamic";

/** Seller chooses, for this return only, whether the Shippo label is deducted. */
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

  const body = (await req.json().catch(() => ({}))) as { pay?: string };
  if (body.pay !== "seller" && body.pay !== "buyer") {
    return NextResponse.json({ error: "Choose who pays for this label." }, { status: 400 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: {
      storeReturns: { orderBy: [...LATEST_STORE_RETURN_ORDER_BY], take: 1 },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const current = order.storeReturns[0];
  if (!current || (current.status !== "awaiting_return" && current.status !== "in_transit")) {
    return NextResponse.json({ error: "This return is not waiting for a label." }, { status: 400 });
  }
  if (current.returnShipmentId) {
    return NextResponse.json({ error: "A return label already exists for this order." }, { status: 400 });
  }

  const updated = await prisma.storeReturn.update({
    where: { id: current.id },
    data: { chargeReturnShipping: body.pay === "buyer" },
  });
  return NextResponse.json({ ok: true, storeReturn: updated });
}
