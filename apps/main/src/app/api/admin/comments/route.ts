import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { content: { contains: search, mode: "insensitive" as const } },
          { member: { firstName: { contains: search, mode: "insensitive" as const } } },
          { member: { lastName: { contains: search, mode: "insensitive" as const } } },
        ],
      }
    : undefined;

  const [comments, total] = await Promise.all([
    prisma.postComment.findMany({
      where,
      include: {
        member: { select: { id: true, firstName: true, lastName: true } },
        post: { select: { id: true, content: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.postComment.count({ where }),
  ]);

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: { id: c.member.id, firstName: c.member.firstName, lastName: c.member.lastName },
      post: { id: c.post.id, contentPreview: c.post.content?.slice(0, 80) ?? "" },
    })),
    total,
    page,
    limit,
  });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const commentId = body.commentId as string;
    if (!commentId)
      return NextResponse.json({ error: "commentId required" }, { status: 400 });

    await prisma.postComment.delete({ where: { id: commentId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
}
