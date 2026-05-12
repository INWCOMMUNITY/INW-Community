import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBlockedMemberIds } from "@/lib/member-block";
import { sortConversationsByLastMessageDesc } from "@/lib/conversation-inbox-sort";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [conversations, blockedIds] = await Promise.all([
    prisma.resaleConversation.findMany({
      where: {
        OR: [{ buyerId: session.user.id }, { sellerId: session.user.id }],
      },
      include: {
        storeItem: { select: { id: true, title: true, slug: true, photos: true } },
        buyer: { select: { id: true, firstName: true, lastName: true } },
        seller: { select: { id: true, firstName: true, lastName: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: true,
            createdAt: true,
            senderId: true,
            resaleOfferId: true,
            resaleOffer: { select: { id: true, status: true } },
          },
        },
      },
    }),
    getBlockedMemberIds(session.user.id),
  ]);
  const filtered = sortConversationsByLastMessageDesc(
    conversations.filter((c) => {
      const otherId = c.buyerId === session.user.id ? c.sellerId : c.buyerId;
      return !blockedIds.has(otherId);
    })
  );

  const withUnread = await Promise.all(
    filtered.map(async (c) => {
      const lastRead = c.buyerId === session.user.id ? c.buyerLastReadAt : c.sellerLastReadAt;
      const unreadCount = await prisma.resaleMessage.count({
        where: {
          conversationId: c.id,
          senderId: { not: session.user.id },
          ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
        },
      });
      return { ...c, unreadCount };
    })
  );

  return NextResponse.json(withUnread);
}
