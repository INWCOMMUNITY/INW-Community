import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { publishGroupConversationRead } from "@/lib/realtime-publish";
import { scheduleRealtimePublish } from "@/lib/schedule-realtime-publish";
import { getBlockedMemberIds } from "@/lib/member-block";

/**
 * PATCH /api/group-conversations/[id]/read
 * Mark the thread as read for the current member (group membership lastReadAt).
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
  const conversation = await prisma.groupConversation.findUnique({
    where: { id },
    include: {
      members: { select: { memberId: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const isMember = conversation.members.some((m) => m.memberId === session.user.id);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const blockedIds = await getBlockedMemberIds(session.user.id);
  const otherMemberIds = conversation.members.map((m) => m.memberId).filter((mid) => mid !== session.user.id);
  if (otherMemberIds.some((mid) => blockedIds.has(mid))) {
    return NextResponse.json({ error: "Conversation not available" }, { status: 404 });
  }

  const lastMessageAt = conversation.messages[0]?.createdAt ?? new Date();

  try {
    await prisma.groupConversationMember.update({
      where: {
        conversationId_memberId: { conversationId: id, memberId: session.user.id },
      },
      data: { lastReadAt: lastMessageAt },
    });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "");
    if ((e as { code?: string })?.code === "P2021" || /last_read_at|column.*does not exist/i.test(msg)) {
      console.warn("[group-conversations/read] last_read_at column missing?");
      return NextResponse.json({ ok: true });
    }
    throw e;
  }

  scheduleRealtimePublish(publishGroupConversationRead(id, session.user.id));

  return NextResponse.json({ ok: true });
}
