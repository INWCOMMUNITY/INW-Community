import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { orderQualifiesForDeferredBuyerPoints } from "@/lib/store-order-buyer-points";

export const dynamic = "force-dynamic";

/**
 * GET ?order_ids=id1,id2
 * Returns total points awarded for the given orders (buyer must own them, orders must be paid).
 * Used by order-success page and mobile after checkout to show points earned popup.
 */
export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orderIdsParam = searchParams.get("order_ids");
  const orderIds = orderIdsParam
    ? orderIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
    : [];
  if (orderIds.length === 0) {
    return NextResponse.json({ pointsAwarded: 0, pointsPendingFulfillment: 0 });
  }

  const orders = await prisma.storeOrder.findMany({
    where: {
      id: { in: orderIds },
      buyerId: session.user.id,
      status: "paid",
    },
    select: {
      pointsAwarded: true,
      buyerPointsReleasedAt: true,
      items: { select: { fulfillmentType: true } },
    },
  });

  let pointsAwarded = 0;
  let pointsPendingFulfillment = 0;
  for (const o of orders) {
    const deferred = orderQualifiesForDeferredBuyerPoints(o.items);
    const pts = o.pointsAwarded ?? 0;
    if (deferred && !o.buyerPointsReleasedAt) {
      pointsPendingFulfillment += pts;
    } else {
      pointsAwarded += pts;
    }
  }
  return NextResponse.json({ pointsAwarded, pointsPendingFulfillment });
}
