import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/me/posts?limit=30&cursor=...
 * Returns posts authored by the current user (profile posts), same shape as feed.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const posts = await prisma.post.findMany({
    where: { authorId: session.user.id },
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

  const sourceBlogIds = items.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourceBusinessIds = items.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);

  const [blogs, businesses, storeItems, likeCounts, commentCounts] = await Promise.all([
    sourceBlogIds.length > 0
      ? prisma.blog.findMany({
          where: { id: { in: sourceBlogIds } },
          select: { id: true, title: true, slug: true, photos: true },
        })
      : [],
    sourceBusinessIds.length > 0
      ? prisma.business.findMany({
          where: { id: { in: sourceBusinessIds } },
          select: { id: true, name: true, slug: true, logoUrl: true },
        })
      : [],
    sourceStoreItemIds.length > 0
      ? prisma.storeItem.findMany({
          where: { id: { in: sourceStoreItemIds } },
          select: { id: true, title: true, slug: true, photos: true },
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

  const blogMap = Object.fromEntries(blogs.map((b) => [b.id, b]));
  const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
  const storeItemMap = Object.fromEntries(storeItems.map((s) => [s.id, s]));
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  const feedItems = items.map((p) => ({
    ...p,
    type: "post",
    tags: p.postTags?.map((pt) => pt.tag) ?? [],
    sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
    sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
    sourceStoreItem: p.sourceStoreItemId ? storeItemMap[p.sourceStoreItemId] ?? null : null,
    likeCount: likeCountMap[p.id] ?? 0,
    commentCount: commentCountMap[p.id] ?? 0,
  }));

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
