import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { discoverShopifyImportCandidates } from "@/lib/shopify/import-discovery";

export const dynamic = "force-dynamic";

/**
 * Seller-authenticated Shopify product discovery for Apps Airport import.
 * Returns unmapped products on the current ACTIVE connection generation only.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");
  const result = await discoverShopifyImportCandidates({
    memberId,
    cursor: cursor?.trim() || null,
  });

  if (result.status === "ERROR") {
    const status =
      result.code === "CONNECTION_REQUIRED" || result.code === "LOCATION_REQUIRED"
        ? 409
        : result.code === "UNAUTHORIZED"
          ? 401
          : 502;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({
    connectionId: result.connectionId,
    shopDomain: result.shopDomain,
    generation: result.generation,
    primaryLocationId: result.primaryLocationId,
    candidates: result.candidates,
    pageInfo: result.pageInfo,
  });
}
