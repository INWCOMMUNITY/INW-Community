import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getBlockedMemberIds } from "@/lib/member-block";
import { getMeActivityFeed } from "@/lib/me-activity-feed";

/**
 * GET /api/me/activity-feed
 * Unified chronological activity for the signed-in member (social, content, events, commerce).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const blocked = await getBlockedMemberIds(session.user.id);
  const items = await getMeActivityFeed(session.user.id, { blockedIds: blocked });

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));
  return NextResponse.json({ items: items.slice(0, limit) });
}
