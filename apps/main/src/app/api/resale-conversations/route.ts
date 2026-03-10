import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBlockedMemberIds } from "@/lib/member-block";

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
          select: { content: true, createdAt: true, senderId: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    getBlockedMemberIds(session.user.id),
  ]);
  const filtered = conversations.filter((c) => {
    const otherId = c.buyerId === session.user.id ? c.sellerId : c.buyerId;
    return !blockedIds.has(otherId);
  });

  return NextResponse.json(filtered);
}
