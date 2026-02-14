import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const existing = await prisma.postLike.findUnique({
    where: {
      postId_memberId: { postId: id, memberId: session.user.id },
    },
  });

  if (existing) {
    await prisma.postLike.delete({
      where: { id: existing.id },
    });
    return NextResponse.json({ liked: false });
  }

  await prisma.postLike.create({
    data: {
      postId: id,
      memberId: session.user.id,
    },
  });
  return NextResponse.json({ liked: true });
}
