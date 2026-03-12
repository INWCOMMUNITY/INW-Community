import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBlockedMemberIds } from "@/lib/member-block";

/**
 * GET /api/me/sidebar-alerts
 * Returns counts for sidebar badge indicators (unread messages, pending friend requests).
 * Unread = message requests (pending from others) + accepted conversations where last message is from the other person.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [conversations, blockedIds, incomingFriendRequests] = await Promise.all([
    prisma.directConversation.findMany({
      where: {
        OR: [
          { memberAId: session.user.id },
          { memberBId: session.user.id },
        ],
      },
      select: {
        status: true,
        requestedByMemberId: true,
        memberAId: true,
        memberBId: true,
        memberALastReadAt: true,
        memberBLastReadAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { senderId: true, createdAt: true },
        },
      },
    }),
    getBlockedMemberIds(session.user.id),
    prisma.friendRequest.count({
      where: { addresseeId: session.user.id, status: "pending" },
    }),
  ]);

  const filtered = conversations.filter((c) => {
    const otherId = c.memberAId === session.user.id ? c.memberBId : c.memberAId;
    return !blockedIds.has(otherId);
  });

  const messageRequestsCount = filtered.filter(
    (c) => c.status === "pending" && c.requestedByMemberId !== session.user.id
  ).length;

  const acceptedWithUnread = filtered.filter((c) => {
    const isAccepted = c.status === "accepted" || c.requestedByMemberId === session.user.id;
    if (!isAccepted) return false;
    const last = c.messages[0];
    if (!last || last.senderId === session.user.id) return false;
    const myLastReadAt = c.memberAId === session.user.id ? c.memberALastReadAt : c.memberBLastReadAt;
    return myLastReadAt == null || last.createdAt > myLastReadAt;
  }).length;

  const unreadMessages = messageRequestsCount + acceptedWithUnread;

  return NextResponse.json({
    unreadMessages,
    incomingFriendRequests,
  });
}
