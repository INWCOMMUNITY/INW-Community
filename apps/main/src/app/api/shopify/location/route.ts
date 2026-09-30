import { NextRequest, NextResponse } from "next/server";
import { getActiveShopifyConnectionForMember, setShopifyPrimaryLocation } from "database";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { fetchShopifyLocations } from "@/lib/shopify/client";
import { accessTokenForConnection, ShopifyConnectError, toPublicShopifyConnection } from "@/lib/shopify/connect";
import { SHOPIFY_LOCATION_GID_PATTERN } from "@/lib/shopify/constants";
import { selectInventoryLocations } from "@/lib/shopify/locations";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }
  let connectionId = "";
  let locationId = "";
  try {
    const body = (await req.json()) as { connectionId?: unknown; locationId?: unknown };
    connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
    locationId = typeof body.locationId === "string" ? body.locationId : "";
  } catch {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }
  if (!SHOPIFY_LOCATION_GID_PATTERN.test(locationId)) {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }
  const connection = await getActiveShopifyConnectionForMember(prisma, memberId, connectionId);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  try {
    const accessToken = await accessTokenForConnection(connection);
    const nodes = await fetchShopifyLocations({ shopDomain: connection.shopDomain, accessToken });
    const allowed = selectInventoryLocations(nodes).some((location) => location.id === locationId);
    if (!allowed) return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  } catch (error) {
    if (error instanceof ShopifyConnectError) {
      return NextResponse.json({ error: "Shopify reauthorization is required" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not verify Shopify location" }, { status: 502 });
  }
  const updated = await setShopifyPrimaryLocation(prisma, { memberId, connectionId, locationId });
  if (!updated) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  return NextResponse.json({ connection: toPublicShopifyConnection(updated) });
}
