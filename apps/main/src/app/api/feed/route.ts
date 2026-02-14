import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const [followed, friendships, myGroups, followedTags] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: session.user.id },
      select: { followingId: true },
    }),
    prisma.friendRequest.findMany({
      where: {
        OR: [
          { requesterId: session.user.id, status: "accepted" },
          { addresseeId: session.user.id, status: "accepted" },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.groupMember.findMany({
      where: { memberId: session.user.id },
      select: { groupId: true },
    }),
    prisma.followTag.findMany({
      where: { memberId: session.user.id },
      select: { tagId: true },
    }),
  ]);

  const followingIds = followed.map((f) => f.followingId);
  const friendIds = [...new Set(
    friendships.flatMap((f) =>
      f.requesterId === session.user.id ? f.addresseeId : f.requesterId
    )
  )];
  const groupIds = myGroups.map((g) => g.groupId);
  const authorIds = new Set([session.user.id, ...followingIds, ...friendIds]);
  const followedTagIds = followedTags.map((f) => f.tagId);

  let sharedBlogIdsWithFollowedTags: string[] = [];
  if (followedTagIds.length > 0) {
    const blogsWithTags = await prisma.blog.findMany({
      where: {
        blogTags: { some: { tagId: { in: followedTagIds } } },
      },
      select: { id: true },
    });
    sharedBlogIdsWithFollowedTags = blogsWithTags.map((b) => b.id);
  }

  const where = {
    OR: [
      { authorId: { in: Array.from(authorIds) } },
      ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
      ...(followedTagIds.length > 0
        ? [
            { postTags: { some: { tagId: { in: followedTagIds } } } },
            ...(sharedBlogIdsWithFollowedTags.length > 0
              ? [{ sourceBlogId: { in: sharedBlogIdsWithFollowedTags } }]
              : []),
          ]
        : []),
    ],
  };

  const posts = await prisma.post.findMany({
    where,
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
  const sourceCouponIds = items.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourceRewardIds = items.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const sourcePostIds = items.filter((p) => p.sourcePostId).map((p) => p.sourcePostId!);

  const [blogs, businesses, coupons, rewards, storeItems, sourcePosts] = await Promise.all([
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
    sourceBusinessIds.length > 0
      ? prisma.business.findMany({
          where: { id: { in: sourceBusinessIds } },
          select: { id: true, name: true, slug: true, shortDescription: true, logoUrl: true },
        })
      : [],
    sourceCouponIds.length > 0
      ? prisma.coupon.findMany({
          where: { id: { in: sourceCouponIds } },
          include: { business: { select: { name: true, slug: true } } },
        })
      : [],
    sourceRewardIds.length > 0
      ? prisma.reward.findMany({
          where: { id: { in: sourceRewardIds } },
          include: { business: { select: { name: true, slug: true } } },
        })
      : [],
    sourceStoreItemIds.length > 0
      ? prisma.storeItem.findMany({
          where: { id: { in: sourceStoreItemIds } },
          select: { id: true, title: true, slug: true, photos: true, priceCents: true },
        })
      : [],
    sourcePostIds.length > 0
      ? prisma.post.findMany({
          where: { id: { in: sourcePostIds } },
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
            },
            postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
          },
        })
      : [],
  ]);

  const blogMap = Object.fromEntries(blogs.map((b) => [b.id, b]));
  const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
  const couponMap = Object.fromEntries(coupons.map((c) => [c.id, c]));
  const rewardMap = Object.fromEntries(rewards.map((r) => [r.id, r]));
  const storeItemMap = Object.fromEntries(storeItems.map((s) => [s.id, s]));

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
          include: { business: { select: { name: true, slug: true } } },
        })
      : [],
    sourcePostRewardIds.length > 0
      ? prisma.reward.findMany({
          where: { id: { in: sourcePostRewardIds } },
          include: { business: { select: { name: true, slug: true } } },
        })
      : [],
    sourcePostStoreItemIds.length > 0
      ? prisma.storeItem.findMany({
          where: { id: { in: sourcePostStoreItemIds } },
          select: { id: true, title: true, slug: true, photos: true, priceCents: true },
        })
      : [],
  ]);

  const sourcePostBlogMap = Object.fromEntries(sourcePostBlogs.map((b) => [b.id, b]));
  const sourcePostBusinessMap = Object.fromEntries(sourcePostBusinesses.map((b) => [b.id, b]));
  const sourcePostCouponMap = Object.fromEntries(sourcePostCoupons.map((c) => [c.id, c]));
  const sourcePostRewardMap = Object.fromEntries(sourcePostRewards.map((r) => [r.id, r]));
  const sourcePostStoreItemMap = Object.fromEntries(sourcePostStoreItems.map((s) => [s.id, s]));

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
        sourceStoreItem: p.sourceStoreItemId ? (sourcePostStoreItemMap[p.sourceStoreItemId] ?? storeItemMap[p.sourceStoreItemId] ?? null) : null,
      },
    ])
  );

  const [likes, likeCounts, commentCounts] = await Promise.all([
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
  const likedSet = new Set(likes.map((l) => l.postId));
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  const feedItems = items.map((p) => ({
    ...p,
    tags: p.postTags?.map((pt) => pt.tag) ?? [],
    sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
    sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
    sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
    sourceReward: p.sourceRewardId ? rewardMap[p.sourceRewardId] ?? null : null,
    sourceStoreItem: p.sourceStoreItemId ? storeItemMap[p.sourceStoreItemId] ?? null : null,
    sourcePost: p.sourcePostId ? sourcePostMap[p.sourcePostId] ?? null : null,
    liked: likedSet.has(p.id),
    likeCount: likeCountMap[p.id] ?? 0,
    commentCount: commentCountMap[p.id] ?? 0,
  }));

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
