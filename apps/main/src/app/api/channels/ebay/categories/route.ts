import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { searchEbayCategories } from "@/lib/channels/ebay/aspects";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/** GET /api/channels/ebay/categories?q= → live eBay leaf-category suggestions for the picker. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ categories: [] });
  }

  const conn = await getMemberConnectionContext(userId, "ebay");
  if (!conn) {
    return NextResponse.json(
      { error: "Connect your eBay account to search categories." },
      { status: 400 }
    );
  }

  try {
    const categories = await searchEbayCategories(conn.accessToken, q);
    return NextResponse.json({ categories });
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 502 });
  }
}
