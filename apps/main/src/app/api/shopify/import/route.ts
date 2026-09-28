import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { importShopifyListing } from "@/lib/shopify/import-listing";

export const dynamic = "force-dynamic";

/**
 * Import one simple unmapped Shopify product into INW.
 * Seller chooses PHYSICAL or MADE_TO_ORDER stock mode.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let shopifyProductId = "";
  let stockMode: "PHYSICAL" | "MADE_TO_ORDER" | "" = "";
  try {
    const body = (await req.json()) as {
      shopifyProductId?: unknown;
      stockMode?: unknown;
    };
    shopifyProductId =
      typeof body.shopifyProductId === "string" ? body.shopifyProductId.trim() : "";
    stockMode =
      body.stockMode === "PHYSICAL" || body.stockMode === "MADE_TO_ORDER"
        ? body.stockMode
        : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!shopifyProductId) {
    return NextResponse.json({ error: "shopifyProductId is required" }, { status: 400 });
  }
  if (!stockMode) {
    return NextResponse.json(
      { error: "Needs stock-mode selection.", code: "STOCK_MODE_REQUIRED" },
      { status: 400 }
    );
  }

  const result = await importShopifyListing({
    memberId,
    shopifyProductId,
    stockMode,
  });

  if (result.status === "ERROR") {
    const status =
      result.code === "ALREADY_MAPPED" ||
      result.code === "UNSUPPORTED_PRODUCT" ||
      result.code === "INVENTORY_UNAVAILABLE" ||
      result.code === "IMPORT_IN_PROGRESS" ||
      result.code === "CONNECTION_CHANGED" ||
      result.code === "CONNECTION_REQUIRED" ||
      result.code === "LOCATION_REQUIRED"
        ? 409
        : result.code === "NOT_FOUND"
          ? 404
          : 400;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({
    status: result.status === "ALREADY_IMPORTED" ? "already_imported" : "imported",
    storeItemId: result.storeItemId,
    listingLinkId: result.listingLinkId,
    shopifyProductId: result.shopifyProductId,
    bootstrap: result.bootstrap,
  });
}
