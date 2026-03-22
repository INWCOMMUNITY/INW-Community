import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBlockedMemberIds } from "@/lib/member-block";

/** Detect DB errors from missing direct_conversation columns (e.g. member_*_last_read_at not migrated yet). */
function isDirectConversationColumnError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? "");
  return (
    (e as { code?: string })?.code === "P2021" ||
    /column.*does not exist|member_a_last_read|member_b_last_read/i.test(msg)
  );
}

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

  let conversations: { status: string; requestedByMemberId: string | null; memberAId: string; memberBId: string; memberALastReadAt: Date | null; memberBLastReadAt: Date | null; messages: { senderId: string; createdAt: Date }[] }[] = [];
  let blockedIds: Set<string> = new Set();
  let incomingFriendRequests = 0;

  try {
    const [convs, blocked, friendCount] = await Promise.all([
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
    conversations = convs;
    blockedIds = blocked;
    incomingFriendRequests = friendCount;
  } catch (e) {
    if (isDirectConversationColumnError(e)) {
      console.warn("[sidebar-alerts] direct_conversation columns missing (migration not run?), returning zero unread");
      return NextResponse.json({ unreadMessages: 0, incomingFriendRequests });
    }
    throw e;
  }

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

  let resaleUnread = 0;
  try {
    const resaleConvs = await prisma.resaleConversation.findMany({
      where: {
        OR: [{ buyerId: session.user.id }, { sellerId: session.user.id }],
      },
      select: {
        buyerId: true,
        sellerId: true,
        buyerLastReadAt: true,
        sellerLastReadAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { senderId: true, createdAt: true },
        },
      },
    });
    resaleUnread = resaleConvs.filter((c) => {
      const otherId = c.buyerId === session.user.id ? c.sellerId : c.buyerId;
      if (blockedIds.has(otherId)) return false;
      const last = c.messages[0];
      if (!last || last.senderId === session.user.id) return false;
      const myRead = c.buyerId === session.user.id ? c.buyerLastReadAt : c.sellerLastReadAt;
      return myRead == null || last.createdAt > myRead;
    }).length;
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "");
    if ((e as { code?: string })?.code === "P2021" || /buyer_last_read|seller_last_read/i.test(msg)) {
      console.warn("[sidebar-alerts] resale_conversation last_read columns missing, skipping resale unread");
    } else {
      throw e;
    }
  }

  const unreadMessages = messageRequestsCount + acceptedWithUnread + resaleUnread;

  return NextResponse.json({
    unreadMessages,
    incomingFriendRequests,
  });
}
