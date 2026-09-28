import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { listEligibleShopifyExportListings } from "@/lib/shopify/eligible-listings";

export const dynamic = "force-dynamic";

/**
 * Seller-owned active simple listings not yet mapped on the current ACTIVE Shopify connection.
 * Read-only; no provider writes.
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
      shopDomain: true,
      generation: true,
      primaryLocationId: true,
      status: true,
    },
  });

  if (!connection) {
    return NextResponse.json({
      connectionStatus: "CONNECTION_REQUIRED",
      inventoryReady: false,
      listings: [],
    });
  }

  const listings = await listEligibleShopifyExportListings({
    memberId,
    connectionId: connection.id,
  });

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    shopDomain: connection.shopDomain,
    generation: connection.generation,
    inventoryReady: Boolean(connection.primaryLocationId),
    locationSelectionRequired: !connection.primaryLocationId,
    listings,
  });
}
