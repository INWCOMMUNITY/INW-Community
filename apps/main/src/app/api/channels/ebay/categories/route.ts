import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasEbayConnection } from "@/lib/channels/connection";
import { searchEbayCategories } from "@/lib/channels/ebay/aspects";
import { describeEbayThrownError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

    const { connected, status: connStatus } = await memberHasEbayConnection(userId);
    // #region agent log
    fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "58be99" },
      body: JSON.stringify({
        sessionId: "58be99",
        runId: "verify-fix",
        hypothesisId: "H1-H2",
        location: "categories/route.ts:gate",
        message: "category search auth gate",
        data: { connected, connStatus, queryLen: q.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    console.log("[debug-58be99] category search gate", {
      runId: "verify-fix",
      connected,
      connStatus,
      queryLen: q.length,
    });
    if (!connected) {
      return NextResponse.json(
        { error: "Connect your eBay account in Sync Stores to search categories." },
        { status: 401 }
      );
    }

    const categories = await searchEbayCategories(q);
    // #region agent log
    fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "58be99" },
      body: JSON.stringify({
        sessionId: "58be99",
        runId: "verify-fix",
        hypothesisId: "H3",
        location: "categories/route.ts:ok",
        message: "category search ok",
        data: { queryLen: q.length, resultCount: categories.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    console.log("[debug-58be99] category search ok", {
      runId: "verify-fix",
      queryLen: q.length,
      resultCount: categories.length,
    });
    return NextResponse.json({ categories });
  } catch (e) {
    const errMsg = describeEbayThrownError(e);
    // #region agent log
    fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "58be99" },
      body: JSON.stringify({
        sessionId: "58be99",
        runId: "verify-fix",
        hypothesisId: "H3-H4",
        location: "categories/route.ts:error",
        message: "category search error",
        data: { error: errMsg.slice(0, 200) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    console.log("[debug-58be99] category search error", {
      runId: "verify-fix",
      error: errMsg.slice(0, 200),
    });
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }
}
