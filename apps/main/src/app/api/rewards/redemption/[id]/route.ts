import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { ensureRewardFulfillmentStoreItem } from "@/lib/reward-fulfillment-store-item";

/**
 * GET — summary for reward shipping checkout (authenticated redeemer only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id, memberId: session.user.id },
    include: {
      reward: {
        select: {
          title: true,
          needsShipping: true,
          business: { select: { memberId: true, name: true } },
        },
      },
    },
  });
  if (!redemption) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!redemption.reward.needsShipping) {
    return NextResponse.json({ error: "This reward does not require shipping checkout" }, { status: 400 });
  }
  if (redemption.fulfillmentStatus && redemption.fulfillmentStatus !== "pending_checkout") {
    return NextResponse.json({ error: "Redemption is not awaiting checkout" }, { status: 400 });
  }
  const sellerId = redemption.reward.business.memberId;
  const { shippingCostCents } = await ensureRewardFulfillmentStoreItem(sellerId);
  return NextResponse.json({
    redemptionId: redemption.id,
    rewardTitle: redemption.reward.title,
    businessName: redemption.reward.business.name,
    shippingCostCents,
  });
}
