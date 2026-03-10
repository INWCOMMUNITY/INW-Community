import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/me/sidebar-alerts
 * Returns counts for sidebar badge indicators (unread messages, pending friend requests).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [unreadMessages, incomingFriendRequests] = await Promise.all([
    Promise.resolve(0), // unread message count when read tracking is implemented
    prisma.friendRequest.count({
      where: { addresseeId: session.user.id, status: "pending" },
    }),
  ]);

  return NextResponse.json({
    unreadMessages,
    incomingFriendRequests,
  });
}
