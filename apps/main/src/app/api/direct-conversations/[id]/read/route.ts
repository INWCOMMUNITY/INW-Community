import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { isBlocked } from "@/lib/member-block";

/**
 * PATCH /api/direct-conversations/[id]/read
 * Mark the conversation as read by the current user (set their lastReadAt to now).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.directConversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.memberAId !== session.user.id && conversation.memberBId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const otherId = conversation.memberAId === session.user.id ? conversation.memberBId : conversation.memberAId;
  if (await isBlocked(session.user.id, otherId)) {
    return NextResponse.json({ error: "Conversation not available" }, { status: 404 });
  }

  const lastMessageAt = conversation.messages[0]?.createdAt ?? new Date();
  const updateData =
    conversation.memberAId === session.user.id
      ? { memberALastReadAt: lastMessageAt }
      : { memberBLastReadAt: lastMessageAt };

  try {
    await prisma.directConversation.update({
      where: { id },
      data: updateData as Prisma.DirectConversationUpdateInput,
    });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "");
    if (
      (e as { code?: string })?.code === "P2021" ||
      /column.*does not exist|member_a_last_read|member_b_last_read/i.test(msg)
    ) {
      console.warn("[direct-conversations/read] direct_conversation last_read columns missing (migration not run?)");
      return NextResponse.json({ ok: true });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
