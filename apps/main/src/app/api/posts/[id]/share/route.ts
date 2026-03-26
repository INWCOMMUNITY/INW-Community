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
    select: {
      id: true,
      type: true,
      authorId: true,
      groupId: true,
      author: { select: { id: true, privacyLevel: true } },
    },
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

  // Enforce privacy: only allow resharing if viewer can see the *source post*.
  // For group posts, group membership is treated as visibility for the content, even if profile is private.
  // For personal posts, friends-only author privacy applies.
  const sourceAuthorPrivacy = sourcePost.author?.privacyLevel ?? "public";
  const viewerId = session.user.id;
  const canViewSourcePost = (() => {
    if (viewerId === sourcePost.authorId) return true;

    // Source post published inside a group: only members can view it.
    if (sourcePost.groupId) {
      return false; // we validate membership below
    }

    if (sourceAuthorPrivacy === "public") return true;
    if (sourceAuthorPrivacy === "friends_only") return false; // validated via friendship below
    if (sourceAuthorPrivacy === "completely_private") return false;
    return false;
  })();

  if (!canViewSourcePost) {
    if (sourcePost.groupId) {
      if (sourceAuthorPrivacy === "completely_private") {
        return NextResponse.json({ error: "Not allowed to share this post" }, { status: 403 });
      }
      const sourceGroupMembership = await prisma.groupMember.findUnique({
        where: { groupId_memberId: { groupId: sourcePost.groupId, memberId: viewerId } },
      });
      if (!sourceGroupMembership) {
        return NextResponse.json({ error: "Not allowed to share this post" }, { status: 403 });
      }
    } else {
      if (sourceAuthorPrivacy === "friends_only") {
        const friendship = await prisma.friendRequest.findFirst({
          where: {
            status: "accepted",
            OR: [
              { requesterId: viewerId, addresseeId: sourcePost.authorId },
              { requesterId: sourcePost.authorId, addresseeId: viewerId },
            ],
          },
          select: { id: true },
        });
        if (!friendship) {
          return NextResponse.json({ error: "Not allowed to share this post" }, { status: 403 });
        }
      } else if (sourceAuthorPrivacy !== "public") {
        return NextResponse.json({ error: "Not allowed to share this post" }, { status: 403 });
      }
    }
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
