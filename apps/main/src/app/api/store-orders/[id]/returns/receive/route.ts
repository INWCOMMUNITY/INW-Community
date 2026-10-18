import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { resolveCommerceInventoryWriter } from "@/lib/commerce-foundation-cutover-http";
import { executeStoreReturnRefund } from "@/lib/store-return-issue-refund";

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
  return executeStoreReturnRefund({ userId, writerRoute: writer.route, order });
}
