import { NextRequest, NextResponse } from "next/server";
import { prisma, ensureShopifyReconcileListingJob } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { listShopifySellerListingViews } from "@/lib/shopify/listing-public-view";

export const dynamic = "force-dynamic";

/**
 * Seller-safe Shopify listing readiness for current-generation mappings only.
 * Never exposes tokens or provider secrets.
 * Does not mutate remote product status (DRAFT stays DRAFT until explicit activation).
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
    select: {
      id: true,
      status: true,
      shopDomain: true,
      generation: true,
      primaryLocationId: true,
    },
  });
  if (!connection) {
    return NextResponse.json({
      connectionStatus: "CONNECTION_REQUIRED",
      shopDomain: null,
      generation: null,
      listings: [],
    });
  }

  const storeItemId = req.nextUrl.searchParams.get("storeItemId")?.trim() || null;
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  let listings = await listShopifySellerListingViews({
    memberId,
    connectionId: connection.id,
  });

  if (storeItemId) {
    listings = listings.filter((row) => row.storeItemId === storeItemId);
  }

  if (refresh) {
    for (const row of listings.slice(0, 20)) {
      await ensureShopifyReconcileListingJob(prisma, {
        connectionId: connection.id,
        listingLinkId: row.listingLinkId,
        storeItemId: row.storeItemId,
        bucket: `on-demand-${Date.now()}`,
      });
    }
    listings = await listShopifySellerListingViews({
      memberId,
      connectionId: connection.id,
    });
    if (storeItemId) {
      listings = listings.filter((row) => row.storeItemId === storeItemId);
    }
  }

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    shopDomain: connection.shopDomain,
    generation: connection.generation,
    listings,
  });
}
