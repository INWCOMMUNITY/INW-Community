import { NextRequest, NextResponse } from "next/server";
import { getActiveShopifyConnectionForMember } from "database";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { fetchShopifyLocations } from "@/lib/shopify/client";
import { accessTokenForConnection, ShopifyConnectError } from "@/lib/shopify/connect";
import { selectInventoryLocations } from "@/lib/shopify/locations";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  const connectionId = req.nextUrl.searchParams.get("connectionId") ?? "";
  if (!connectionId) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const connection = await getActiveShopifyConnectionForMember(prisma, memberId, connectionId);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  try {
    const accessToken = await accessTokenForConnection(connection);
    const nodes = await fetchShopifyLocations({ shopDomain: connection.shopDomain, accessToken });
    const locations = selectInventoryLocations(nodes).map((location) => ({
      id: location.id,
      name: location.name,
    }));
    return NextResponse.json({
      connectionId: connection.id,
      primaryLocationId: connection.primaryLocationId,
      locations,
    });
  } catch (error) {
    if (error instanceof ShopifyConnectError) {
      return NextResponse.json({ error: "Shopify reauthorization is required" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not load Shopify locations" }, { status: 502 });
  }
}
