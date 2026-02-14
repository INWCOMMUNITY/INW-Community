import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  content: z.string().max(2000).default(""),
  photos: z.array(z.string().min(1)).max(6).optional().default([]),
  parentId: z.string().optional(),
}).refine(
  (data) => (data.content?.trim() ?? "").length > 0 || (data.photos?.length ?? 0) > 0,
  { message: "Comment must have text or photos" }
);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const session = await getSessionForApi(req as NextRequest);
  const comments = await prisma.postComment.findMany({
    where: { postId: id },
    include: {
      member: {
        select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
      },
      parent: {
        select: { id: true, memberId: true, member: { select: { firstName: true, lastName: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const commentIds = comments.map((c) => c.id);
  const [likeCounts, likedByMe] = await Promise.all([
    prisma.postCommentLike.groupBy({
      by: ["commentId"],
      where: { commentId: { in: commentIds } },
      _count: { commentId: true },
    }),
    session?.user?.id
      ? prisma.postCommentLike.findMany({
          where: { commentId: { in: commentIds }, memberId: session.user.id },
          select: { commentId: true },
        })
      : [],
  ]);
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.commentId, l._count.commentId]));
  const likedSet = new Set(likedByMe.map((l) => l.commentId));

  const result = comments.map((c) => ({
    ...c,
    likeCount: likeCountMap[c.id] ?? 0,
    liked: likedSet.has(c.id),
    parentAuthorName: c.parent
      ? `${c.parent.member.firstName ?? ""} ${c.parent.member.lastName ?? ""}`.trim()
      : null,
  }));

  return NextResponse.json({ comments: result });
}

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

  try {
    const body = await req.json();
    const { content, photos, parentId } = bodySchema.parse(body);

    if (parentId) {
      const parent = await prisma.postComment.findFirst({
        where: { id: parentId, postId: id },
      });
      if (!parent) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
      }
    }

    const comment = await prisma.postComment.create({
      data: {
        postId: id,
        ...(parentId ? { parentId } : {}),
        memberId: session.user.id,
        content: (content ?? "").trim() || " ",
        photos: photos ?? [],
      },
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
        },
      },
    });
    return NextResponse.json(comment);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors?.[0]?.message ?? e.message ?? "Invalid comment";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const err = e as Error;
    console.error("[POST /api/posts/[id]/comments]", err);
    const message =
      process.env.NODE_ENV === "development"
        ? err.message ?? "Failed to create comment"
        : "Failed to create comment. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
