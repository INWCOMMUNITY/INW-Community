import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getItemAspectsForCategory, requireEbayTaxonomyConfig } from "@/lib/channels/ebay/aspects";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/ebay/category-aspects?categoryId=
 *
 * Required/recommended item specifics for an eBay leaf category.
 * Uses eBay application credentials (Taxonomy API).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const categoryId = req.nextUrl.searchParams.get("categoryId")?.trim() ?? "";
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
  }

  try {
    requireEbayTaxonomyConfig();
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 503 });
  }

  try {
    const aspects = await getItemAspectsForCategory(categoryId);
    return NextResponse.json({ aspects });
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 502 });
  }
}
