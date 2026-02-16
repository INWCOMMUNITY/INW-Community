import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const ALLOWED_EMOJIS = ["heart", "thumbsup", "laugh", "wow", "sad", "angry"] as const;

const bodySchema = z.object({
  emoji: z.enum(ALLOWED_EMOJIS),
});

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

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
  }

  const existing = await prisma.directMessageReaction.findUnique({
    where: {
      messageId_memberId_emoji: {
        messageId,
        memberId: session.user.id,
        emoji: data.emoji,
      },
    },
  });

  if (existing) {
    await prisma.directMessageReaction.delete({
      where: {
        messageId_memberId_emoji: {
          messageId,
          memberId: session.user.id,
          emoji: data.emoji,
        },
      },
    });
    return NextResponse.json({ reacted: false, emoji: data.emoji });
  }

  await prisma.directMessageReaction.create({
    data: {
      messageId,
      memberId: session.user.id,
      emoji: data.emoji,
    },
  });
  return NextResponse.json({ reacted: true, emoji: data.emoji });
}
