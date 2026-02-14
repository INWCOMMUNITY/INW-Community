import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId, messageId } = await params;

  const conversation = await prisma.directConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, memberAId: true, memberBId: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.memberAId !== session.user.id && conversation.memberBId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const message = await prisma.directMessage.findUnique({
    where: { id: messageId, conversationId },
  });
  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const existing = await prisma.directMessageLike.findUnique({
    where: { messageId_memberId: { messageId, memberId: session.user.id } },
  });

  if (existing) {
    await prisma.directMessageLike.delete({
      where: { messageId_memberId: { messageId, memberId: session.user.id } },
    });
    return NextResponse.json({ liked: false });
  }

  await prisma.directMessageLike.create({
    data: { messageId, memberId: session.user.id },
  });
  return NextResponse.json({ liked: true });
}
