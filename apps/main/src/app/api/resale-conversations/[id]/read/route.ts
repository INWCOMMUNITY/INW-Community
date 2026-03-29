import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { publishResaleConversationRead } from "@/lib/realtime-publish";
import { isBlocked } from "@/lib/member-block";

/**
 * PATCH /api/resale-conversations/[id]/read
 * Mark the thread as read for the current user (buyer or seller).
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(_req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.resaleConversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.buyerId !== session.user.id && conversation.sellerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const otherId = conversation.buyerId === session.user.id ? conversation.sellerId : conversation.buyerId;
  if (await isBlocked(session.user.id, otherId)) {
    return NextResponse.json({ error: "Conversation not available" }, { status: 404 });
  }

  const lastMessageAt = conversation.messages[0]?.createdAt ?? new Date();
  const data =
    conversation.buyerId === session.user.id
      ? { buyerLastReadAt: lastMessageAt }
      : { sellerLastReadAt: lastMessageAt };

  try {
    await prisma.resaleConversation.update({
      where: { id },
      data,
    });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "");
    if ((e as { code?: string })?.code === "P2021" || /buyer_last_read|seller_last_read/i.test(msg)) {
      console.warn("[resale-conversations/read] last_read columns missing?");
      return NextResponse.json({ ok: true });
    }
    throw e;
  }

  await publishResaleConversationRead(id, session.user.id);

  return NextResponse.json({ ok: true });
}
