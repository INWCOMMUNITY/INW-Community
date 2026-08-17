import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasEbayConnection } from "@/lib/channels/connection";
import { searchEbayCategories } from "@/lib/channels/ebay/aspects";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/** GET /api/channels/ebay/categories?q= → live eBay leaf-category suggestions for the picker. */
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

    const { connected } = await memberHasEbayConnection(userId);
    if (!connected) {
      return NextResponse.json(
        { error: "Connect your eBay account in Sync Stores to search categories." },
        { status: 401 }
      );
    }

    const categories = await searchEbayCategories(q);
    console.log("[debug-58be99] category search ok", {
      runId: "post-fix",
      queryLen: q.length,
      resultCount: categories.length,
    });
    return NextResponse.json({ categories });
  } catch (e) {
    const errMsg = describeEbayThrownError(e);
    console.log("[debug-58be99] category search error", {
      runId: "post-fix",
      error: errMsg.slice(0, 200),
    });
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }
}
