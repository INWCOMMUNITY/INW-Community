import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { canViewerSeeFeedItem } from "@/lib/feed-post-viewer-access";

const VALID_REACTIONS = ["leaf", "love", "laugh", "support", "insightful"] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  let reaction = "leaf";
  try {
    const body = await req.json();
    if (body?.reaction) {
      if (!VALID_REACTIONS.includes(body.reaction)) {
        return NextResponse.json(
          { error: `Invalid reaction. Must be one of: ${VALID_REACTIONS.join(", ")}` },
          { status: 400 }
        );
      }
      reaction = body.reaction;
    }
  } catch {
    // No body or invalid JSON — use default reaction
  }

  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, privacyLevel: true } },
    },
  });
  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  let sourcePost: { author: { id: string; privacyLevel: string | null } | null; groupId: string | null } | null = null;
  if (post.sourcePostId) {
    sourcePost = await prisma.post.findUnique({
      where: { id: post.sourcePostId },
      select: {
        author: { select: { id: true, privacyLevel: true } },
        groupId: true,
      },
    });
  }

  const viewerId = session.user.id;
  const [friendships, myGroups] = await Promise.all([
    prisma.friendRequest.findMany({
      where: {
        OR: [
          { requesterId: viewerId, status: "accepted" },
          { addresseeId: viewerId, status: "accepted" },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.groupMember.findMany({
      where: { memberId: viewerId },
      select: { groupId: true },
    }),
  ]);
  const friendIds = friendships.map((f) =>
    f.requesterId === viewerId ? f.addresseeId : f.requesterId
  );
  const feedItem = { ...post, sourcePost };
  if (!canViewerSeeFeedItem(feedItem, viewerId, new Set(friendIds), new Set(myGroups.map((g) => g.groupId)))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const existing = await prisma.postLike.findUnique({
    where: {
      postId_memberId: { postId: id, memberId: session.user.id },
    },
  });

  if (existing) {
    if (existing.reaction === reaction) {
      await prisma.postLike.delete({ where: { id: existing.id } });
      return NextResponse.json({ liked: false });
    }
    const updated = await prisma.postLike.update({
      where: { id: existing.id },
      data: { reaction },
    });
    return NextResponse.json({ liked: true, reaction: updated.reaction });
  }

  await prisma.postLike.create({
    data: {
      postId: id,
      memberId: session.user.id,
      reaction,
    },
  });
  return NextResponse.json({ liked: true, reaction });
}
