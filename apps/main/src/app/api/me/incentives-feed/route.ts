import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getMeIncentivesFeed } from "@/lib/me-incentives-feed";

/**
 * GET /api/me/incentives-feed
 * Badges, QR scan points, order points, and coupon points for the Activity “Incentives” tab.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));
  const items = await getMeIncentivesFeed(session.user.id);
  return NextResponse.json({ items: items.slice(0, limit) });
}
