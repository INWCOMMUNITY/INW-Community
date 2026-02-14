import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  content: z.string().max(5000).optional().nullable(),
  groupId: z.string().optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sourcePostId } = await params;
  const sourcePost = await prisma.post.findUnique({
    where: { id: sourcePostId },
    select: { id: true, type: true },
  });

  if (!sourcePost) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  let body: { content?: string | null; groupId?: string | null } = {};
  try {
    const raw = await req.json().catch(() => ({}));
    body = bodySchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
  }

  let groupId: string | null = null;
  let type = "shared_post";
  if (body.groupId) {
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_memberId: { groupId: body.groupId, memberId: session.user.id },
      },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
    }
    groupId = body.groupId;
  }

  const post = await prisma.post.create({
    data: {
      type,
      authorId: session.user.id,
      content: body.content ?? null,
      photos: [],
      videos: [],
      sourcePostId: sourcePostId,
      groupId,
    },
  });

  return NextResponse.json({ post });
}
