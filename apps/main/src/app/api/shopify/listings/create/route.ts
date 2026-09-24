import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { enqueueShopifyCreateListing } from "@/lib/shopify/create-listing";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

/**
 * Explicit seller action: queue CREATE_LISTING for a simple StoreItem.
 * Does not wait for Shopify productSet.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let storeItemId = "";
  try {
    const body = (await req.json()) as { storeItemId?: unknown };
    storeItemId = typeof body.storeItemId === "string" ? body.storeItemId.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!storeItemId) {
    return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
  }

  const result = await enqueueShopifyCreateListing({ memberId, storeItemId });
  if (result.status === "ALREADY_MAPPED") {
    return NextResponse.json({
      status: "already_mapped",
      connectionId: result.connectionId,
      storeItemId: result.storeItemId,
      shopifyProductId: result.shopifyProductId,
    });
  }
  if (result.status === "QUEUED") {
    return NextResponse.json({
      status: "queued",
      connectionId: result.connectionId,
      storeItemId: result.storeItemId,
      jobId: result.jobId,
    });
  }

  const status =
    result.code === "NOT_FOUND"
      ? 404
      : result.code === "CONNECTION_INACTIVE" || result.code === "LOCATION_REQUIRED"
        ? 409
        : result.code === "UNSUPPORTED_VARIANTS" || result.code === "CONFLICT"
          ? 409
          : 400;
  return NextResponse.json({ error: result.message, code: result.code }, { status });
}
