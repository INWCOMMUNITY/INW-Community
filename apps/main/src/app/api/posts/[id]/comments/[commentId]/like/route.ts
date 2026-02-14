import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const session = await getSessionForApi(_req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId, commentId } = await params;

  const comment = await prisma.postComment.findFirst({
    where: { id: commentId, postId },
  });
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const existing = await prisma.postCommentLike.findUnique({
    where: {
      commentId_memberId: { commentId, memberId: session.user.id },
    },
  });

  if (existing) {
    await prisma.postCommentLike.delete({
      where: { id: existing.id },
    });
    return NextResponse.json({ liked: false });
  }

  await prisma.postCommentLike.create({
    data: {
      commentId,
      memberId: session.user.id,
    },
  });
  return NextResponse.json({ liked: true });
}
