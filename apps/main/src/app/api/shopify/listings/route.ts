import { NextRequest, NextResponse } from "next/server";
import { prisma, toPublicShopifyListingStatus } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { ensureShopifyReconcileListingJob } from "database";

export const dynamic = "force-dynamic";

/**
 * Seller-safe Shopify listing readiness for current-generation mappings only.
 * Never exposes tokens or provider secrets.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, status: true },
  });
  if (!connection) {
    return NextResponse.json({
      connectionStatus: "CONNECTION_REQUIRED",
      listings: [],
    });
  }

  const listings = await prisma.shopifyListingLink.findMany({
    where: { shopifyConnectionId: connection.id, memberId },
    orderBy: { updatedAt: "desc" },
  });

  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh) {
    for (const row of listings.slice(0, 20)) {
      await ensureShopifyReconcileListingJob(prisma, {
        connectionId: connection.id,
        listingLinkId: row.id,
        storeItemId: row.storeItemId,
        bucket: `on-demand-${Date.now()}`,
      });
    }
  }

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    listings: listings.map(toPublicShopifyListingStatus),
  });
}
