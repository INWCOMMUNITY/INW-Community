import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getShopifyExportReadiness } from "@/lib/shopify/export-readiness";

export const dynamic = "force-dynamic";

/**
 * Preflight for List on Shopify on the listing form.
 * Read-only; no provider writes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(_req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const { id: storeItemId } = await params;
  if (!storeItemId?.trim()) {
    return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
  }

  const readiness = await getShopifyExportReadiness({
    memberId,
    storeItemId: storeItemId.trim(),
  });
  return NextResponse.json(readiness);
}
