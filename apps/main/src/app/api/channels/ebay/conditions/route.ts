import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getEbayConditionFixContext } from "@/lib/channels/ebay/fix-condition";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/** GET /api/channels/ebay/conditions?storeItemId= — allowed conditions for in-app picker. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeItemId = req.nextUrl.searchParams.get("storeItemId")?.trim();
  if (!storeItemId) {
    return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
  }

  try {
    const ctx = await getEbayConditionFixContext(userId, storeItemId);
    if (!ctx) {
      return NextResponse.json({ error: "Listing not found or eBay not connected." }, { status: 404 });
    }
    return NextResponse.json(ctx);
  } catch (e) {
    return NextResponse.json({ error: describeEbayThrownError(e) }, { status: 502 });
  }
}
