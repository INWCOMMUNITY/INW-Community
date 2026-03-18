import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/members/[id]/posts?limit=30&cursor=...
 * Returns posts authored by the member. Visibility matches profile: only if viewer can see full profile (self, or friend when profile is friends_only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: memberId } = await params;
  const session = await getSessionForApi(req);
  const viewerId = session?.user?.id ?? null;

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, privacyLevel: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const isSelf = viewerId === memberId;
  const isPrivate =
    member.privacyLevel === "friends_only" || member.privacyLevel === "completely_private";
  let canSeeFullProfile = isSelf;
  if (!canSeeFullProfile && isPrivate && viewerId) {
    const friendship = await prisma.friendRequest.findFirst({
      where: {
        status: "accepted",
        OR: [
          { requesterId: viewerId, addresseeId: memberId },
          { requesterId: memberId, addresseeId: viewerId },
        ],
      },
    });
    canSeeFullProfile = !!friendship;
  }

  if (!canSeeFullProfile) {
    return NextResponse.json({ posts: [], nextCursor: null });
  }

  const posts = await prisma.post.findMany({
    where: { authorId: memberId },
    include: {
      author: {
        select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
      },
      postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = posts.length > limit;
  const items = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;
  const postIds = items.map((p) => p.id);

  const [likes, likeCounts, commentCounts] = await Promise.all([
    viewerId
      ? prisma.postLike.findMany({
          where: { postId: { in: postIds }, memberId: viewerId },
          select: { postId: true },
        })
      : [],
    prisma.postLike.groupBy({
      by: ["postId"],
      where: { postId: { in: postIds } },
      _count: { postId: true },
    }),
    prisma.postComment.groupBy({
      by: ["postId"],
      where: { postId: { in: postIds } },
      _count: { postId: true },
    }),
  ]);

  const likedSet = new Set(likes.map((l) => l.postId));
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  const feedItems = items.map((p) => ({
    ...p,
    type: "post",
    tags: p.postTags?.map((pt) => pt.tag) ?? [],
    liked: viewerId ? likedSet.has(p.id) : false,
    likeCount: likeCountMap[p.id] ?? 0,
    commentCount: commentCountMap[p.id] ?? 0,
  }));

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
