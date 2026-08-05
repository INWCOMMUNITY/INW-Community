import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getQuantityAuditLog, type QuantityChangeReason } from "@/lib/channels/quantity-audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/seller/quantity-audit
 *
 * Get paginated quantity audit log for the current seller's items.
 *
 * Query params:
 * - storeItemId: Filter by specific item
 * - provider: Filter by provider (inwc, etsy, ebay, shopify, wix)
 * - reason: Filter by reason (sale, restock, sync_pull, manual_edit, refund, bulk_edit)
 * - limit: Number of records (default 50, max 100)
 * - offset: Pagination offset
 *
 * Response:
 * {
 *   logs: [...],
 *   total: number,
 *   limit: number,
 *   offset: number
 * }
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const storeItemId = searchParams.get("storeItemId") || undefined;
  const provider = searchParams.get("provider") || undefined;
  const reason = searchParams.get("reason") as QuantityChangeReason | undefined;
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

  try {
    const { logs, total } = await getQuantityAuditLog({
      memberId: userId,
      storeItemId,
      provider,
      reason,
      limit,
      offset,
    });

    return NextResponse.json({
      logs,
      total,
      limit,
      offset,
    });
  } catch (e) {
    console.error("[quantity-audit] API error:", e);
    return NextResponse.json(
      { error: "Failed to fetch audit log" },
      { status: 500 }
    );
  }
}
