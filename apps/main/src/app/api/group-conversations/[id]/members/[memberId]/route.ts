import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, memberId } = await params;
  const membership = await prisma.groupConversationMember.findUnique({
    where: {
      conversationId_memberId: { conversationId: id, memberId },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "Member not in conversation" }, { status: 404 });
  }

  const myMembership = await prisma.groupConversationMember.findUnique({
    where: {
      conversationId_memberId: { conversationId: id, memberId: session.user.id },
    },
  });
  if (!myMembership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (memberId !== session.user.id) {
    return NextResponse.json({ error: "You can only remove yourself from the group" }, { status: 403 });
  }

  await prisma.groupConversationMember.delete({
    where: {
      conversationId_memberId: { conversationId: id, memberId },
    },
  });

  return NextResponse.json({ ok: true });
}
