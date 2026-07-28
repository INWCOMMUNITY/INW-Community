import { prisma } from "database";
import type { NextRequest } from "next/server";
import { getSellerAnalyticsSource } from "@/lib/seller-analytics-source";
import { getSessionForApi } from "@/lib/mobile-auth";

/** Fire-and-forget listing view for seller analytics. Counts every product detail fetch, including the lister. */
export function recordSellerListingView(
  req: NextRequest,
  storeItemId: string,
  memberId: string
): void {
  const source = getSellerAnalyticsSource(req);
  prisma.sellerAnalyticsEvent
    .create({
      data: {
        memberId,
        storeItemId,
        eventType: "listing_view",
        provider: "inwc",
        source,
      },
    })
    .catch((e) => {
      console.warn("[recordSellerListingView]", e);
    });
  
  recordMemberListingView(req, storeItemId, source);
}

/** Records viewer-level view for "Customers Also Viewed" feature. */
async function recordMemberListingView(
  req: NextRequest,
  storeItemId: string,
  source: "mobile" | "web"
): Promise<void> {
  try {
    const session = await getSessionForApi(req);
    const viewerId = session?.user?.id ?? null;
    
    if (!viewerId) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const existing = await prisma.memberListingView.findFirst({
      where: {
        viewerId,
        storeItemId,
        createdAt: { gte: today },
      },
    });
    
    if (existing) return;
    
    await prisma.memberListingView.create({
      data: {
        viewerId,
        storeItemId,
        source,
      },
    });
  } catch (e) {
    console.warn("[recordMemberListingView]", e);
  }
}
