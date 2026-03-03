import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/me/sidebar-alerts
 * Returns counts for sidebar badge indicators (e.g. unread messages).
 * unreadMessages: 0 until read tracking is implemented.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    unreadMessages: 0,
  });
}
