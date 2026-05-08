import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { isFeedPostRenderable } from "@/lib/feed-post-visible";
import { storeItemRowsToFeedEmbedMap } from "@/lib/store-item-variants";
import {
  collectTaggedBusinessIdsFromPosts,
  mergePostBusinessLookupIds,
  taggedBusinessesFromIds,
} from "@/lib/feed-tagged-businesses";

/**
 * GET /api/me/posts?limit=30&cursor=...
 * Returns posts authored by the current user (profile posts), same shape as feed.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

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
  const businessLookupIdsMe = mergePostBusinessLookupIds(
    sourceBusinessIds,
    collectTaggedBusinessIdsFromPosts(items)
  );
  const sourceCouponIds = items.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourceRewardIds = items.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const sourcePostIds = items.filter((p) => p.sourcePostId).map((p) => p.sourcePostId!);
  const postGroupIds = items.filter((p) => p.groupId).map((p) => p.groupId!);

  const [blogs, businesses, coupons, rewards, storeItems, sourcePosts, groups, likes, likeCounts, commentCounts] = await Promise.all([
    sourceBlogIds.length > 0
      ? prisma.blog.findMany({
          where: { id: { in: sourceBlogIds } },
          include: {
            member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
            category: { select: { name: true, slug: true } },
            blogTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
          },
        })
      : [],
    businessLookupIdsMe.length > 0
      ? prisma.business.findMany({
          where: { id: { in: businessLookupIdsMe } },
          select: { id: true, name: true, slug: true, shortDescription: true, logoUrl: true },
        })
      : [],
    sourceCouponIds.length > 0
      ? prisma.coupon.findMany({
          where: { id: { in: sourceCouponIds } },
          include: { business: { select: { id: true, name: true, slug: true } } },
        })
      : [],
    sourceRewardIds.length > 0
      ? prisma.reward.findMany({
          where: { id: { in: sourceRewardIds } },
          include: { business: { select: { id: true, name: true, slug: true } } },
        })
      : [],
    sourceStoreItemIds.length > 0
      ? prisma.storeItem.findMany({
          where: { id: { in: sourceStoreItemIds } },
          select: { id: true, title: true, slug: true, photos: true, priceCents: true, status: true, quantity: true },
        })
      : [],
    sourcePostIds.length > 0
      ? prisma.post.findMany({
          where: { id: { in: sourcePostIds } },
          include: {
            author: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
            postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
          },
        })
      : [],
    postGroupIds.length > 0
      ? prisma.group.findMany({
          where: { id: { in: postGroupIds } },
          select: { id: true, name: true, slug: true },
        })
      : [],
    prisma.postLike.findMany({
      where: { postId: { in: postIds }, memberId: session.user.id },
      select: { postId: true },
    }),
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
  const couponMap = Object.fromEntries(coupons.map((c) => [c.id, c]));
  const rewardMap = Object.fromEntries(rewards.map((r) => [r.id, r]));
  const groupMap = Object.fromEntries((groups as { id: string; name: string; slug: string }[]).map((g) => [g.id, g]));
  const likedSet = new Set(likes.map((l) => l.postId));
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  // Resolve sourcePost nested sources (same shape as feed)
  const sourcePostBlogIds = sourcePosts.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourcePostBusinessIds = sourcePosts.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const sourcePostCouponIds = sourcePosts.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourcePostRewardIds = sourcePosts.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourcePostStoreItemIds = sourcePosts.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const [sourcePostBlogs, sourcePostBusinesses, sourcePostCoupons, sourcePostRewards, sourcePostStoreItems] = await Promise.all([
    sourcePostBlogIds.length > 0
      ? prisma.blog.findMany({
          where: { id: { in: sourcePostBlogIds } },
          include: {
            member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
            category: { select: { name: true, slug: true } },
            blogTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
          },
        })
      : [],
    sourcePostBusinessIds.length > 0
      ? prisma.business.findMany({
          where: { id: { in: sourcePostBusinessIds } },
          select: { id: true, name: true, slug: true, shortDescription: true, logoUrl: true },
        })
      : [],
    sourcePostCouponIds.length > 0
      ? prisma.coupon.findMany({
          where: { id: { in: sourcePostCouponIds } },
          include: { business: { select: { id: true, name: true, slug: true } } },
        })
      : [],
    sourcePostRewardIds.length > 0
      ? prisma.reward.findMany({
          where: { id: { in: sourcePostRewardIds } },
          include: { business: { select: { id: true, name: true, slug: true } } },
        })
      : [],
    sourcePostStoreItemIds.length > 0
      ? prisma.storeItem.findMany({
          where: { id: { in: sourcePostStoreItemIds } },
          select: { id: true, title: true, slug: true, photos: true, priceCents: true, status: true, quantity: true },
        })
      : [],
  ]);
  const storeItemEmbedMerge = new Map<
    string,
    { id: string; title: string; slug: string; photos: string[]; priceCents: number; status: string; quantity: number }
  >();
  for (const s of storeItems) storeItemEmbedMerge.set(s.id, s);
  for (const s of sourcePostStoreItems) storeItemEmbedMerge.set(s.id, s);
  const feedStoreItemMap = storeItemRowsToFeedEmbedMap([...storeItemEmbedMerge.values()]);

  const sourcePostBlogMap = Object.fromEntries(sourcePostBlogs.map((b) => [b.id, b]));
  const sourcePostBusinessMap = Object.fromEntries(sourcePostBusinesses.map((b) => [b.id, b]));
  const sourcePostCouponMap = Object.fromEntries(sourcePostCoupons.map((c) => [c.id, c]));
  const sourcePostRewardMap = Object.fromEntries(sourcePostRewards.map((r) => [r.id, r]));
  const sourcePostMap = Object.fromEntries(
    sourcePosts.map((p) => [
      p.id,
      {
        ...p,
        tags: p.postTags?.map((pt) => pt.tag) ?? [],
        sourceBlog: p.sourceBlogId ? (sourcePostBlogMap[p.sourceBlogId] ?? blogMap[p.sourceBlogId] ?? null) : null,
        sourceBusiness: p.sourceBusinessId ? (sourcePostBusinessMap[p.sourceBusinessId] ?? businessMap[p.sourceBusinessId] ?? null) : null,
        sourceCoupon: p.sourceCouponId ? (sourcePostCouponMap[p.sourceCouponId] ?? couponMap[p.sourceCouponId] ?? null) : null,
        sourceReward: p.sourceRewardId ? (sourcePostRewardMap[p.sourceRewardId] ?? rewardMap[p.sourceRewardId] ?? null) : null,
        sourceStoreItem: p.sourceStoreItemId ? (feedStoreItemMap[p.sourceStoreItemId] ?? null) : null,
      },
    ])
  );

  const feedItems = items
    .map((p) => ({
      ...p,
      tags: p.postTags?.map((pt) => pt.tag) ?? [],
      sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
      sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
      taggedBusinesses: taggedBusinessesFromIds(p.taggedBusinessIds, businessMap),
      sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
      sourceReward: p.sourceRewardId ? rewardMap[p.sourceRewardId] ?? null : null,
      sourceStoreItem: p.sourceStoreItemId ? feedStoreItemMap[p.sourceStoreItemId] ?? null : null,
      sourcePost: p.sourcePostId ? sourcePostMap[p.sourcePostId] ?? null : null,
      sourceGroup: p.groupId ? groupMap[p.groupId] ?? null : null,
      liked: likedSet.has(p.id),
      likeCount: likeCountMap[p.id] ?? 0,
      commentCount: commentCountMap[p.id] ?? 0,
    }))
    .filter(isFeedPostRenderable);

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
