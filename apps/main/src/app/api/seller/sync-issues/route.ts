import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSyncIssues } from "@/lib/channels/sync-health";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/seller/sync-issues
 *
 * Get detailed sync issues for the current seller.
 *
 * Query params:
 * - provider: Filter by provider (etsy, ebay, shopify, wix)
 * - type: Filter by issue type (error, conflict, pending_retry)
 * - limit: Number of records (default 50, max 100)
 * - offset: Pagination offset
 *
 * Response:
 * {
 *   issues: [
 *     {
 *       id: string,
 *       storeItemId: string,
 *       storeItemTitle: string,
 *       provider: string,
 *       issueType: "error" | "conflict" | "pending_retry",
 *       syncStatus: string,
 *       syncError: string | null,
 *       conflictResolution: string | null,
 *       lastConflictAt: Date | null,
 *       nextRetryAt: Date | null,
 *       retryAttempts: number,
 *       createdAt: Date,
 *       updatedAt: Date
 *     },
 *     ...
 *   ],
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
  const provider = searchParams.get("provider") as ChannelProvider | null;
  const issueType = searchParams.get("type") as "error" | "conflict" | "pending_retry" | null;
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

  try {
    const { issues, total } = await getSyncIssues({
      memberId: userId,
      provider: provider || undefined,
      issueType: issueType || undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      issues,
      total,
      limit,
      offset,
    });
  } catch (e) {
    console.error("[sync-issues] API error:", e);
    return NextResponse.json(
      { error: "Failed to fetch sync issues" },
      { status: 500 }
    );
  }
}
