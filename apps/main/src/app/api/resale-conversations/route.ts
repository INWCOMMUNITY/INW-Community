import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [conversations, blocks] = await Promise.all([
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
    prisma.memberBlock.findMany({
      where: { blockerId: session.user.id },
      select: { blockedId: true },
    }),
  ]);
  const blockedIds = new Set(blocks.map((b) => b.blockedId));
  const filtered = conversations.filter((c) => {
    const otherId = c.buyerId === session.user.id ? c.sellerId : c.buyerId;
    return !blockedIds.has(otherId);
  });

  return NextResponse.json(filtered);
}
