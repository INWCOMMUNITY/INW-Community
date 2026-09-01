import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  EBAY_CATEGORY_SEARCH_BUSY_NOTICE,
  requireEbayTaxonomyConfig,
  searchEbayCategories,
} from "@/lib/channels/ebay/aspects";
import {
  describeChannelSyncError,
  describeEbayThrownError,
  isEbayRateLimitError,
} from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/channels/ebay/categories?q=
 *
 * Live eBay leaf-category suggestions for the listing picker.
 * Uses eBay application credentials (Taxonomy API) — does not require a healthy seller OAuth token.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return NextResponse.json({ categories: [] });
    }

    try {
      requireEbayTaxonomyConfig();
    } catch (e) {
      return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 503 });
    }

    const categories = await searchEbayCategories(q);
    return NextResponse.json({ categories });
  } catch (e) {
    if (isEbayRateLimitError(e)) {
      return NextResponse.json({
        categories: [],
        warning: EBAY_CATEGORY_SEARCH_BUSY_NOTICE,
        rateLimited: true,
      });
    }
    const errMsg = describeChannelSyncError("ebay", e);
    return NextResponse.json({ error: errMsg || EBAY_CATEGORY_SEARCH_BUSY_NOTICE }, { status: 502 });
  }
}
