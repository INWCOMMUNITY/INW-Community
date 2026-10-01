import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getShopifyListingViewUrl } from "@/lib/shopify/listing-actions";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const { id: storeItemId } = await params;
  if (!storeItemId?.trim()) {
    return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
  }

  const result = await getShopifyListingViewUrl({
    memberId,
    storeItemId: storeItemId.trim(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    primaryUrl: result.primaryUrl,
    adminUrl: result.adminUrl,
    storefrontUrl: result.storefrontUrl,
  });
}
