import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import {
  endedListingRetentionCutoff,
  visibleEndedStoreItemWhere,
} from "@/lib/store-item-ended-status";

export const dynamic = "force-dynamic";

/**
 * POST /api/store-items/clear-ended
 * Hides every ended listing still on the seller's Ended tab.
 * StoreItem rows stay so order history is kept.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(userId),
  });
  if (!sellerSub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  const cutoff = endedListingRetentionCutoff();
  const result = await prisma.storeItem.updateMany({
    where: visibleEndedStoreItemWhere(userId),
    data: { endedAt: new Date(cutoff.getTime() - 1000) },
  });

  return NextResponse.json({ cleared: result.count });
}
