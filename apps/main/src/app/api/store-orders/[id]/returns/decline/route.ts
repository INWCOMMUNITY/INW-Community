import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { notifyBuyerReturnDeclined } from "@/lib/store-return-notify";

export const dynamic = "force-dynamic";

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

  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // optional
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "A decline reason is required" }, { status: 400 });
  }

  const { id } = await params;
  const order = await prisma.storeOrder.findFirst({
    where: { id, sellerId: userId },
    include: { storeReturns: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const current = order.storeReturns[0];
  if (!current || current.status !== "requested") {
    return NextResponse.json({ error: "No pending return request to decline" }, { status: 400 });
  }

  const updated = await prisma.storeReturn.update({
    where: { id: current.id },
    data: {
      status: "declined",
      declineReason: reason,
      declinedAt: new Date(),
    },
  });

  notifyBuyerReturnDeclined(order.buyerId, order.id, reason);
  return NextResponse.json({ ok: true, storeReturn: updated });
}
