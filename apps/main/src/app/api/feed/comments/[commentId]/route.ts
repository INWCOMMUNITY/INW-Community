import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { commentId: string } }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commentId } = params;

  const comment = await prisma.feedComment.findUnique({
    where: { id: commentId },
    select: { id: true, memberId: true, post: { select: { authorId: true } } },
  });

  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const isCommentAuthor = comment.memberId === session.user.id;
  const isPostOwner = comment.post.authorId === session.user.id;

  if (!isCommentAuthor && !isPostOwner) {
    return NextResponse.json({ error: "Not authorized to delete this comment" }, { status: 403 });
  }

  await prisma.feedComment.delete({ where: { id: commentId } });

  return NextResponse.json({ ok: true });
}
