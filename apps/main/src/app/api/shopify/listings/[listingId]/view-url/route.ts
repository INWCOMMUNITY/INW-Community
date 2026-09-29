import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { resolveShopifyListingViewUrls } from "@/lib/shopify/listing-view-urls";
import { shopifyListingUiStatus } from "@/lib/shopify/apps-airport";

export const dynamic = "force-dynamic";

/**
 * Resolve View-on-Shopify URLs for a synced listing.
 * Prefer storefront when Live; always include Admin fallback.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ listingId: string }> }
) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const { listingId: storeItemId } = await context.params;
  if (!storeItemId?.trim()) {
    return NextResponse.json({ error: "Listing id required" }, { status: 400 });
  }

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, shopDomain: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "No active Shopify connection" }, { status: 409 });
  }

  const listing = await prisma.shopifyListingLink.findFirst({
    where: {
      shopifyConnectionId: connection.id,
      memberId,
      storeItemId,
    },
    select: {
      shopifyProductId: true,
      readiness: true,
      contentHealth: true,
      inventoryHealth: true,
      issueCode: true,
    },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing is not synced on this Shopify connection" }, { status: 404 });
  }

  const ui = shopifyListingUiStatus(listing);
  const urls = await resolveShopifyListingViewUrls({
    connectionId: connection.id,
    shopDomain: connection.shopDomain,
    shopifyProductId: listing.shopifyProductId,
    preferStorefront: ui === "Live",
  });

  return NextResponse.json({
    status: ui,
    storefrontUrl: urls.storefrontUrl,
    adminUrl: urls.adminUrl,
    primaryUrl: urls.primaryUrl,
  });
}
